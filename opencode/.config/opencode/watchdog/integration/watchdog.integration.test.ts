/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { createSession, listSessions, promptAsync, startProbeInstance, waitFor, type ProbeInstance } from "./harness"

const PRODUCTION_ENTRY = new URL("../../plugins/watchdog.ts", import.meta.url).pathname

let instance: ProbeInstance
let invalid: ProbeInstance

type StoredMessage = { info: Record<string, any>; parts: Array<Record<string, any>> }

async function storedMessages(host: ProbeInstance, sessionID: string): Promise<StoredMessage[]> {
  const response = await fetch(`${host.baseUrl}/session/${sessionID}/message`)
  return response.json() as Promise<StoredMessage[]>
}

function userTexts(messages: StoredMessage[]): string[] {
  return messages
    .filter((message) => message.info?.role === "user")
    .map((message) =>
      message.parts
        .filter((part) => part.type === "text" && part.synthetic !== true)
        .map((part) => part.text)
        .join("\n"),
    )
}

beforeAll(async () => {
  instance = await startProbeInstance({
    pluginEntry: PRODUCTION_ENTRY,
    watchdogConfig: {
      enabled: true,
      model: "probe/critic-model",
      everyTools: 5,
      onIdle: true,
      timeoutMs: 5_000,
      foreignContinuationSettleMs: 0,
      midRunDelivery: false,
    },
    env: { OPENCODE_LOG_LEVEL: "INFO" },
  })
  invalid = await startProbeInstance({
    pluginEntry: PRODUCTION_ENTRY,
    watchdogConfig: { enabled: true, model: "not-a-model" },
  })
}, 120_000)

afterAll(async () => {
  await instance?.stop()
  await invalid?.stop()
})

describe("production watchdog idle-only slice", () => {
  test("one root idle review runs a fresh isolated critic child, parses ok, emits no feedback, and leaves no child", async () => {
    try {
      const sessionID = await createSession(instance, "watchdog-idle")
      await promptAsync(instance, sessionID, "Implement the bounded watchdog task.")
      await waitFor("completed main turn", async () => {
        const messages = await storedMessages(instance, sessionID)
        return messages.some((message) => message.info?.role === "assistant" && message.info?.time?.completed) ? true : undefined
      }, 20_000)

      const critic = await waitFor("critic provider request", () => instance.llm.requestsOf("critic")[0], 20_000)
      expect(critic.body.model).toBe("critic-model")
      expect(critic.body.tool_choice).toBeUndefined()
      expect(critic.body.response_format).toMatchObject({
        type: "json_schema",
        json_schema: { name: "watchdog_verdict", strict: true },
      })
      expect(critic.body.max_tokens ?? critic.body.max_completion_tokens ?? critic.body.max_output_tokens).toBe(256)
      const serialized = JSON.stringify(critic.body.messages ?? [])
      expect(serialized).toContain("Implement the bounded watchdog task.")

      await Bun.sleep(1_000)
      expect(instance.llm.requestsOf("critic")).toHaveLength(1)

      await waitFor("critic child cleanup", async () => {
        const sessions = await listSessions(instance)
        return sessions.some((session) => session.parentID === sessionID) ? undefined : true
      }, 10_000)

      const messages = await storedMessages(instance, sessionID)
      expect(userTexts(messages).some((text) => text.startsWith("[watchdog advisory:"))).toBe(false)
      expect(JSON.stringify(messages)).not.toContain("watchdog advisory")
    } catch (error) {
      writeFileSync("/tmp/watchdog-production-logs.txt", instance.logs())
      throw error
    }
  }, 60_000)

  test("invalid configuration disables review with a bounded reason and no model fallback", async () => {
    const sessionID = await createSession(invalid, "watchdog-disabled")
    await promptAsync(invalid, sessionID, "This turn should not trigger a review.")
    await Bun.sleep(2_000)
    expect(invalid.llm.requestsOf("critic")).toHaveLength(0)
    expect(invalid.logs()).toContain("model must use the provider/model form")
  }, 30_000)
})
