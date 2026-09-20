/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import {
  createSession,
  getSession,
  listSessions,
  promptAsync,
  startProbeInstance,
  waitFor,
  type ProbeInstance,
} from "./harness"
import { WATCHDOG_PROBE_TRIGGER } from "./probe-plugin"

let instance: ProbeInstance

function childSessions(sessions: Array<Record<string, any>>, rootID: string) {
  return sessions.filter((session) => session.parentID === rootID)
}

function tokenLimit(body: Record<string, any>): number | undefined {
  return body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens
}

function thinkingDisabled(body: Record<string, any>): boolean {
  if (body.enable_thinking === false) return true
  if (body.chat_template_kwargs?.enable_thinking === false) return true
  if (body.extra_body?.chat_template_kwargs?.enable_thinking === false) return true
  if (body.reasoning_effort === "none") return true
  return false
}

beforeAll(async () => {
  instance = await startProbeInstance({
    env: { WATCHDOG_PROBE_TIMEOUT_MS: "600", OPENCODE_LOG_LEVEL: "DEBUG" },
  })
}, 90_000)

afterAll(async () => {
  await instance?.stop()
})

describe("watchdog critic provider contract", () => {
  test("normal completion creates a parent-linked critic child, captures the request, and deletes the child", async () => {
    try {
      const root = await createSession(instance, "critic-contract")
      await promptAsync(instance, root, WATCHDOG_PROBE_TRIGGER)

      const request = await waitFor("critic provider request", () => instance.llm.requestsOf("critic")[0], 15_000)
      const body = request.body

      expect(body.model).toBe("critic-model")
      const assistantSessions = childSessions(await listSessions(instance), root)
      const toolPart = body.tools
      expect(toolPart === undefined || (Array.isArray(toolPart) && toolPart.length === 0)).toBe(true)
      expect(body.tool_choice).toBeUndefined()
      expect(body.response_format).toMatchObject({
        type: "json_schema",
        json_schema: { name: "watchdog_verdict", strict: true },
      })
      expect(tokenLimit(body), JSON.stringify(body)).toBe(256)
      expect(thinkingDisabled(body), JSON.stringify(body)).toBe(true)

      await waitFor("critic child deletion", async () =>
        childSessions(await listSessions(instance), root).length === 0 ? true : undefined,
      )
      expect(assistantSessions.length).toBeLessThanOrEqual(1)
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 30_000)

  test("the child runs the dedicated agent and model instead of inheriting the root build agent", async () => {
    try {
      const root = await createSession(instance, "critic-isolation")
      const abortsBefore = instance.llm.criticAborts
      instance.llm.holdCritic = true
      try {
        await promptAsync(instance, root, WATCHDOG_PROBE_TRIGGER)
        await waitFor("held critic request", () => instance.llm.requestsOf("critic")[0])

        const child = await waitFor("critic child session", async () => {
          const sessions = childSessions(await listSessions(instance), root)
          return sessions[0]
        })
        const info = await getSession(instance, child.id)
        expect(info.parentID).toBe(root)

        const messages = await fetch(`${instance.baseUrl}/session/${child.id}/message`).then(
          (response) => response.json() as Promise<Array<Record<string, any>>>,
        )
      const userMessage = messages.find((message) => message.info?.role === "user")
      expect(userMessage?.info?.agent).toBe("watchdog-critic")
      expect(userMessage?.info?.model?.modelID ?? userMessage?.info?.modelID).toBe("critic-model")
      expect(userMessage?.info?.model?.providerID ?? userMessage?.info?.providerID).toBe("probe")

        await waitFor(
          "critic abort after timeout",
          () => (instance.llm.criticAborts >= abortsBefore + 1 ? true : undefined),
          10_000,
        )
        await waitFor("critic child deletion", async () =>
          childSessions(await listSessions(instance), root).length === 0 ? true : undefined,
        )
      } finally {
        instance.llm.holdCritic = false
      }
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 30_000)

  test("merged agent configuration keeps hidden and one-step settings or records the fallback", async () => {
    const config = await fetch(`${instance.baseUrl}/config`).then(
      (response) => response.json() as Promise<Record<string, any>>,
    )
    const critic = config.agent?.["watchdog-critic"]
    expect(critic, `watchdog-critic missing from merged config: ${JSON.stringify(Object.keys(config.agent ?? {}))}`).toBeDefined()
    expect(critic.hidden, `hidden was not preserved: ${JSON.stringify(critic)}`).toBe(true)
    expect(critic.options?.enable_thinking, `thinking option was not preserved: ${JSON.stringify(critic)}`).toBe(false)
    expect(critic.steps, `steps must stay unset: a step limit injects a MAXIMUM STEPS REACHED notice into critic requests (${JSON.stringify(critic)})`).toBeUndefined()
    expect(critic.permission?.["*"], `permission deny was not preserved: ${JSON.stringify(critic)}`).toBe("deny")
  })

  test("a timed-out critic is server-aborted before a replacement request starts", async () => {
    try {
      const root = await createSession(instance, "critic-overlap")
      const before = instance.llm.requestsOf("critic").length
      const abortsBefore = instance.llm.criticAborts
      instance.llm.maxActiveCritic = 0
      instance.llm.holdCritic = true
      try {
        await promptAsync(instance, root, WATCHDOG_PROBE_TRIGGER)
        await waitFor("first critic request", () => instance.llm.requestsOf("critic")[before], 10_000)
        await waitFor(
          "server abort",
          () => (instance.llm.criticAborts >= abortsBefore + 1 ? true : undefined),
          10_000,
        )
      } finally {
        instance.llm.holdCritic = false
      }

      await promptAsync(instance, root, `${WATCHDOG_PROBE_TRIGGER} again`)
      await waitFor("replacement critic request", () => instance.llm.requestsOf("critic")[before + 1], 10_000)
      expect(instance.llm.maxActiveCritic).toBe(1)
      expect(instance.llm.requestsOf("critic").length).toBe(before + 2)
      await waitFor(
        "replacement child deletion",
        async () => (childSessions(await listSessions(instance), root).length === 0 ? true : undefined),
        10_000,
      )
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 30_000)
})
