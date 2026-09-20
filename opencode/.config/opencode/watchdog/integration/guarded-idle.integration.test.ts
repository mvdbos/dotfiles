/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { createSession, promptAsync, startProbeInstance, waitFor, type ProbeInstance } from "./harness"

const PRODUCTION_ENTRY = new URL("../../plugins/watchdog.ts", import.meta.url).pathname

type StoredMessage = { info: Record<string, any>; parts: Array<Record<string, any>> }

function makeInstance(midRunDelivery = true, onIdle = true) {
  return startProbeInstance({
    pluginEntry: PRODUCTION_ENTRY,
    watchdogConfig: {
      enabled: true,
      model: "probe/critic-model",
      everyTools: 5,
      onIdle,
      timeoutMs: 5_000,
      foreignContinuationSettleMs: 0,
      midRunDelivery,
    },
  })
}

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

describe("production guarded idle concerns", () => {
  test("a warning produces one visible marker-tagged follow-up and the next idle does not recurse", async () => {
    let instance: ProbeInstance | undefined
    try {
      instance = await makeInstance(false)
      instance.llm.criticText = JSON.stringify({
        status: "concern",
        severity: "warning",
        category: "requirement_drift",
        message: "The implementation renames the public endpoint that the task requires to stay stable.",
      })
      const sessionID = await createSession(instance, "guarded-idle")
      await promptAsync(instance, sessionID, "Implement the task without breaking the public API.")

      const advisory = await waitFor(
        "watchdog idle follow-up",
        async () => userTexts(await storedMessages(instance!, sessionID)).find((text) => text.startsWith("[watchdog advisory:")),
        30_000,
      )
      expect(advisory).toContain("Potential issue:")

      const criticRequest = instance.llm.requestsOf("critic")[0]!
      const criticPrompt = JSON.stringify(criticRequest.body.messages)
      expect(criticPrompt).toContain("conservative trajectory critic")
      expect(criticPrompt).not.toContain("PROBE_FIXTURE_AGENTS_MARKER")
      const mainPrompt = JSON.stringify(instance.llm.requestsOf("main")[0]!.body.messages)
      expect(mainPrompt).toContain("PROBE_FIXTURE_AGENTS_MARKER")

      const messages = await storedMessages(instance, sessionID)
      const advisoryMessage = messages.find((message) =>
        message.parts.some((part) => part.type === "text" && part.text === advisory),
      )
      expect(advisoryMessage?.parts.some((part) => part.synthetic === true)).toBe(false)
      expect(advisoryMessage?.parts[0]?.metadata?.watchdog?.version).toBe(1)

      const before = instance.llm.requestsOf("critic").length
      await Bun.sleep(2_000)
      expect(instance.llm.requestsOf("critic").length).toBe(before)
      expect(userTexts(await storedMessages(instance, sessionID)).filter((text) => text.startsWith("[watchdog advisory:"))).toHaveLength(1)
    } catch (error) {
      if (instance) writeFileSync("/tmp/watchdog-logs.txt", instance.logs())
      throw error
    } finally {
      await instance?.stop()
    }
  }, 90_000)

  test("cadence review installs the advisory request-locally after five tools without persisting it", async () => {
    let instance: ProbeInstance | undefined
    try {
      instance = await makeInstance(true, false)
      instance.llm.criticText = JSON.stringify({
        status: "concern",
        severity: "warning",
        category: "repeated_failure",
        message: "The same failing command was repeated with identical errors across several tool calls.",
      })
      instance.llm.mainScript = [
        ...Array.from({ length: 6 }, (_, index) => ({
          kind: "tool" as const,
          tool: "bash",
          args: { command: `echo step-${index}` },
          id: `call_${index + 1}`,
        })),
        { kind: "text" as const, text: "Done with the steps." },
      ]
      instance.llm.mainRequests = 0
      let release: (() => void) | undefined
      instance.llm.mainHold = new Promise<void>((resolve) => {
        release = resolve
      })
      instance.llm.mainHoldIndex = 5
      const sessionID = await createSession(instance, "cadence-review")
      await promptAsync(instance, sessionID, "Run the five steps in order.")

      await waitFor("cadence critic request", () => instance!.llm.requestsOf("critic")[0], 30_000)
      release?.()
      instance.llm.mainHold = undefined
      instance.llm.mainHoldIndex = undefined

      const withAdvisory = await waitFor(
        "request-local advisory",
        () =>
          instance!.llm
            .requestsOf("main")
            .find((request) => JSON.stringify(request.body.messages ?? []).includes("watchdog advisory")),
        20_000,
      )
      expect(withAdvisory).toBeDefined()

      const stored = JSON.stringify(await storedMessages(instance, sessionID))
      expect(stored).not.toContain("watchdog advisory")
      expect(instance.llm.requestsOf("critic")).toHaveLength(1)
    } catch (error) {
      if (instance) writeFileSync("/tmp/watchdog-logs.txt", instance.logs())
      throw error
    } finally {
      await instance?.stop()
    }
  }, 90_000)
})
