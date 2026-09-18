/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GOAL_PLUGIN_PACKAGE, matchForeignContinuation, BUILT_IN_FOREIGN_PATTERNS } from "../../plugin-generated-user/helpers"
import { api, createSession, listSessions, promptAsync, startProbeInstance, waitFor, type ProbeInstance } from "./harness"

let instance: ProbeInstance
let debugPath: string
let statePath: string

type StoredMessage = { info: Record<string, any>; parts: Array<Record<string, any>> }

async function storedMessages(sessionID: string): Promise<StoredMessage[]> {
  return api(instance, "GET", `/session/${sessionID}/message`)
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

function continuationTexts(messages: StoredMessage[]): string[] {
  return userTexts(messages).filter((text) => matchForeignContinuation(text, BUILT_IN_FOREIGN_PATTERNS) !== undefined)
}

function goalStatus(sessionID: string): string | undefined {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { goals?: Record<string, { status?: string }> }
    return state.goals?.[sessionID]?.status
  } catch {
    return undefined
  }
}

function goalTokens(sessionID: string): number {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { goals?: Record<string, { tokensUsed?: number }> }
    return state.goals?.[sessionID]?.tokensUsed ?? 0
  } catch {
    return 0
  }
}

async function waitForAssistantCompletion(sessionID: string, minimumCount = 1) {
  return waitFor(
    "assistant completion",
    async () => {
      const assistants = (await storedMessages(sessionID)).filter(
        (message) => message.info?.role === "assistant" && message.info?.time?.completed,
      )
      return assistants.length >= minimumCount ? assistants.at(-1) : undefined
    },
    20_000,
  )
}

function probeStats(): { cancelled: number; prompted: number } {
  let cancelled = 0
  let prompted = 0
  try {
    for (const line of readFileSync(debugPath, "utf8").split("\n")) {
      const cancelledMatch = line.match(/"cancelled":(\d+)/)
      const promptedMatch = line.match(/"prompted":(\d+)/)
      if (cancelledMatch) cancelled = Math.max(cancelled, Number(cancelledMatch[1]))
      if (promptedMatch) prompted = Math.max(prompted, Number(promptedMatch[1]))
    }
  } catch {
    // no debug output yet
  }
  return { cancelled, prompted }
}

async function startGoal(
  sessionID: string,
  objective: string,
  extra: Record<string, unknown> = {},
  expected: (status: string | undefined) => boolean = (status) => status === "active",
) {
  instance.llm.mainScript = [
    { kind: "tool", tool: "create_goal", args: { max_auto_turns: 1, objective, ...extra }, id: "call_goal" },
    { kind: "text", text: "Goal active." },
  ]
  instance.llm.mainRequests = 0
  await api(instance, "POST", `/session/${sessionID}/command`, {
    command: "goal",
    arguments: objective,
    model: "probe/main-model",
    agent: "build",
  })
  await waitFor("goal state", () => (expected(goalStatus(sessionID)) ? true : undefined), 20_000)
}

beforeAll(async () => {
  debugPath = join(process.env.TMPDIR ?? "/tmp", `watchdog-idle-probe-${crypto.randomUUID()}.log`)
  writeFileSync(debugPath, "")
  statePath = join(mkdtempSync(join(tmpdir(), "watchdog-goal-")), "goals.json")
  instance = await startProbeInstance({
    pluginEntry: new URL("./idle-goal-probe-plugin.ts", import.meta.url).pathname,
    pluginExport: "IdleGoalProbePlugin",
    plugins: [GOAL_PLUGIN_PACKAGE],
    linkCachePackages: ["@prevalentware"],
    env: {
      WATCHDOG_IDLE_PROBE_DEBUG: debugPath,
      WATCHDOG_IDLE_PROBE_SETTLE_MS: "300",
      WATCHDOG_IDLE_PROBE_PROMPT_LIMIT: "1",
      OPENCODE_GOAL_STATE_PATH: statePath,
      OPENCODE_LOG_LEVEL: "INFO",
    },
  })
}, 120_000)

afterAll(async () => {
  await instance?.stop()
})

describe("goal-plugin 0.1.49 idle arbitration", () => {
  test("active goal idle delivers one goal continuation and cancels watchdog idle admission", async () => {
    try {
      const sessionID = await createSession(instance, "goal-active")
      await startGoal(sessionID, "Implement the probe objective faithfully.")

      const continuations = await waitFor(
        "active goal continuation",
        async () => {
          const matches = continuationTexts(await storedMessages(sessionID))
          return matches.length > 0 ? matches : undefined
        },
        30_000,
      )

      const pattern = matchForeignContinuation(continuations[0]!, BUILT_IN_FOREIGN_PATTERNS)
      expect(pattern?.id).toBe("goal-0.1.49-active")
      expect(pattern?.plugin).toBe(GOAL_PLUGIN_PACKAGE)
      await Bun.sleep(2_000)

      await Bun.sleep(1_000)
      const stats = probeStats()
      expect(stats.cancelled).toBeGreaterThanOrEqual(1)
      expect(stats.prompted).toBe(0)
      const debugText = readFileSync(debugPath, "utf8")
      expect(debugText).toContain("event=idle")
      expect(debugText).toContain("event=status")

      const texts = userTexts(await storedMessages(sessionID))
      expect(texts.some((text) => text.startsWith("[watchdog advisory:"))).toBe(false)
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 60_000)

  test("a parent-linked critic child defers goal continuation and deletion releases it", async () => {
    try {
      const sessionID = await createSession(instance, "goal-deferral")
      await startGoal(sessionID, "Deferral probe objective.")
      const child = await api<{ id: string }>(instance, "POST", "/session", {
        parentID: sessionID,
        title: "probe critic child",
      })

      await Bun.sleep(8_000)
      expect(continuationTexts(await storedMessages(sessionID)).length).toBe(0)

      await api(instance, "DELETE", `/session/${child.id}`)
      await waitFor(
        "continuation after child deletion",
        async () => {
          const matches = continuationTexts(await storedMessages(sessionID))
          return matches.length > 0 ? matches : undefined
        },
        30_000,
      )
      await Bun.sleep(2_000)
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 90_000)

  test("budget-limited goal produces the exact limit continuation fixture", async () => {
    try {
      const sessionID = await createSession(instance, "goal-limit")
      await startGoal(sessionID, "Budget probe objective.", { token_budget: 1 }, (status) => status !== undefined)

      const limitText = await waitFor(
        "limit continuation",
        async () => {
          const texts = userTexts(await storedMessages(sessionID))
          return texts.find((text) => text.startsWith("The active session goal has reached a safety limit."))
        },
        30_000,
      )
      const pattern = matchForeignContinuation(limitText, BUILT_IN_FOREIGN_PATTERNS)
      expect(pattern?.id).toBe("goal-0.1.49-limit")
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 60_000)

  test("detached idle prompt wakes exactly one root response and preserves agent and model", async () => {
    try {
      const sessionID = await createSession(instance, "idle-wake")
      await promptAsync(instance, sessionID, "ordinary probe task")

      const advisory = await waitFor(
        "watchdog advisory prompt",
        async () => {
          const texts = userTexts(await storedMessages(sessionID))
          return texts.find((text) => text.startsWith("[watchdog advisory:"))
        },
        30_000,
      )
      expect(advisory).toContain("probe root prompt 1")

      const messages = await storedMessages(sessionID)
      const advisoryMessage = messages.find((message) =>
        message.parts.some((part) => part.type === "text" && part.text === advisory),
      )
      expect(advisoryMessage?.info?.agent).toBe("build")
      expect(advisoryMessage?.info?.model).toEqual({ providerID: "probe", modelID: "main-model" })
      expect(JSON.stringify(advisoryMessage?.parts?.some((part) => (part as any).synthetic === true))).toBe("false")

      const advisories = userTexts(messages).filter((text) => text.startsWith("[watchdog advisory:"))
      expect(advisories).toHaveLength(1)

      await waitFor(
        "assistant response to the advisory",
        async () => {
          const current = await storedMessages(sessionID)
          const index = current.findIndex((message) =>
            message.parts.some((part) => part.type === "text" && part.text === advisory),
          )
          return current
            .slice(index + 1)
            .some((message) => message.info?.role === "assistant" && message.info?.time?.completed)
            ? true
            : undefined
        },
        20_000,
      )
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 60_000)

  test("root advisory usage counts toward the goal while critic-child usage does not", async () => {
    try {
      const sessionID = await createSession(instance, "goal-tokens")
      await startGoal(sessionID, "Token probe objective.")
      const continuation = await waitFor(
        "first continuation",
        async () => {
          const texts = userTexts(await storedMessages(sessionID))
          return texts.find((text) => text.startsWith("Continue working toward the active session goal."))
        },
        30_000,
      )
      expect(continuation).toBeDefined()
      await Bun.sleep(5_000)
      const baseline = goalTokens(sessionID)
      expect(baseline).toBeGreaterThan(0)

      const child = await api<{ id: string }>(instance, "POST", "/session", {
        parentID: sessionID,
        title: "token critic child",
      })
      await promptAsync(instance, child.id, "child probe task")
      await waitForAssistantCompletion(child.id)
      await Bun.sleep(1_000)
      expect(goalTokens(sessionID)).toBe(baseline)

      await promptAsync(instance, sessionID, "root advisory probe task")
      await waitFor(
        "root usage increase",
        () => (goalTokens(sessionID) > baseline ? true : undefined),
        20_000,
      )

      const children = (await listSessions(instance)).filter((session) => session.parentID === sessionID)
      expect(children.map((session) => session.id)).toEqual([child.id])
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 120_000)
})
