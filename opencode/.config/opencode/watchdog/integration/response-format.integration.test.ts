/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { createSession, promptAsync, startProbeInstance, waitFor, type ProbeInstance } from "./harness"

const PRODUCTION_ENTRY = new URL("../../plugins/watchdog.ts", import.meta.url).pathname

describe("watchdog critic structured output", () => {
  test("critic requests carry a json_schema response_format", async () => {
    let instance: ProbeInstance | undefined
    try {
      instance = await startProbeInstance({
        pluginEntry: PRODUCTION_ENTRY,
        watchdogConfig: {
          enabled: true,
          model: "probe/critic-model",
          onIdle: true,
          timeoutMs: 5_000,
          foreignContinuationSettleMs: 0,
        },
      })
      instance.llm.criticText = JSON.stringify({ status: "ok" })
      const sessionID = await createSession(instance, "response-format")
      await promptAsync(instance, sessionID, "Implement the task.")
      const critic = await waitFor("critic request", () => instance!.llm.requestsOf("critic")[0], 30_000)
      console.log("critic body keys:", Object.keys(critic.body).join(","))
      console.log("response_format:", JSON.stringify(critic.body.response_format)?.slice(0, 300))
      console.log("enable_thinking:", JSON.stringify(critic.body.enable_thinking))
      expect(critic.body.response_format).toMatchObject({
        type: "json_schema",
        json_schema: { name: "watchdog_verdict", strict: true },
      })
    } finally {
      await instance?.stop()
    }
  }, 90_000)
})
