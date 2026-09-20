/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { api, createSession, promptAsync, readTuiLog, startProbeInstance, startTui, waitFor, type ProbeInstance } from "./harness"

let instance: ProbeInstance

type StoredMessage = { info: Record<string, any>; parts: Array<Record<string, any>> }

async function storedMessages(sessionID: string): Promise<StoredMessage[]> {
  return api(instance, "GET", `/session/${sessionID}/message`)
}

async function waitForTuiText(fragment: string, timeoutMs = 20_000) {
  return waitFor(
    `tui text ${fragment}`,
    async () => ((await readTuiLog(instance)).includes(fragment) ? true : undefined),
    timeoutMs,
    250,
  )
}

beforeAll(async () => {
  instance = await startProbeInstance({
    pluginEntry: new URL("./idle-goal-probe-plugin.ts", import.meta.url).pathname,
    pluginExport: "IdleGoalProbePlugin",
    env: {
      OPENCODE_LOG_LEVEL: "INFO",
      WATCHDOG_IDLE_PROBE_DEBUG: "/tmp/watchdog-tui-debug.txt",
    },
  })
}, 120_000)

afterAll(async () => {
  await instance?.stop()
})

describe("idle feedback visibility", () => {
  test("marker-tagged non-synthetic text renders in the TUI while synthetic text stays hidden", async () => {
    try {
      const sessionID = await createSession(instance, "tui-visibility")
      await startTui(instance, { sessionID, readyText: "tui-visibility", timeoutMs: 90_000 })

      await promptAsync(instance, sessionID, "__watchdog_probe_visible__")
      const visible = await waitFor(
        "visible advisory message",
        async () =>
          (await storedMessages(sessionID)).find((message) =>
            message.parts.some((part) => part.type === "text" && part.text?.includes("visible probe advisory line")),
          ),
        30_000,
      )
      const visiblePart = visible.parts.find((part) => part.text?.includes("visible probe advisory line"))
      expect(visiblePart?.synthetic).not.toBe(true)
      expect(visiblePart?.metadata?.watchdog?.version).toBe(1)
      await waitForTuiText("visible probe advisory line")

      await promptAsync(instance, sessionID, "__watchdog_probe_synthetic__")
      await waitFor(
        "stored synthetic advisory",
        async () =>
          (await storedMessages(sessionID)).find((message) =>
            message.parts.some((part) => part.type === "text" && part.text?.includes("synthetic probe advisory line")),
          ),
        30_000,
      )
      await Bun.sleep(3_000)
      expect(await readTuiLog(instance)).not.toContain("synthetic probe advisory line")

    } catch (error) {
      try {
        writeFileSync("/tmp/watchdog-tui.log", readFileSync(instance.tuiLog, "utf8"))
      } catch {
        // no tui log
      }
      throw error
    }
  }, 180_000)
})
