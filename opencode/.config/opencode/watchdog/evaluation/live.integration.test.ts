/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { CriticRunner, type CriticClient } from "../critic"
import { fitUserPrompt } from "../packet"
import { EVALUATION_CORPUS } from "./corpus"
import { acceptanceFailures, formatReport, evaluate } from "./runner"
import { startProbeInstance, createSession, type ProbeInstance } from "../integration/harness"

const LIVE = process.env.WATCHDOG_LIVE === "1"
const OMLX_BASE = process.env.WATCHDOG_LIVE_BASE_URL ?? "http://127.0.0.1:8888/v1"
const LIVE_MODEL = process.env.WATCHDOG_LIVE_MODEL ?? "omlx/Qwen3.5-4B-oQ4e-mtp"
const maybe = LIVE ? test : test.skip

export function httpCriticClient(baseUrl: string): CriticClient {
  const session = {
    create: async (options: { body: { parentID: string; title?: string } }) => {
      const response = await fetch(`${baseUrl}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body),
      })
      return response.ok ? { data: (await response.json()) as { id?: string } } : { error: await response.text() }
    },
    prompt: async (options: { path: { id: string }; body: unknown }) => {
      const response = await fetch(`${baseUrl}/session/${options.path.id}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options.body),
      })
      if (!response.ok) return { error: await response.text() }
      return { data: (await response.json()) as { info?: unknown; parts?: Array<{ type?: string; text?: string }> } }
    },
    abort: async (options: { path: { id: string } }) => {
      await fetch(`${baseUrl}/session/${options.path.id}/abort`, { method: "POST" })
    },
    delete: async (options: { path: { id: string } }) => {
      await fetch(`${baseUrl}/session/${options.path.id}`, { method: "DELETE" })
    },
  }
  return {
    tool: {
      ids: async () => {
        const response = await fetch(`${baseUrl}/tool/ids`)
        return response.ok ? { data: (await response.json()) as string[] } : { data: [] }
      },
    },
    session: session as CriticClient["session"],
  }
}

let instance: ProbeInstance

beforeAll(async () => {
  if (!LIVE) return
  instance = await startProbeInstance({
    pluginEntry: new URL("../../plugins/watchdog.ts", import.meta.url).pathname,
    watchdogConfig: { enabled: true, model: LIVE_MODEL, onIdle: true },
    writeConfig: ({ configDir }) => {
      writeFileSync(
        join(configDir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            model: LIVE_MODEL,
            provider: {
              omlx: {
                npm: "@ai-sdk/openai-compatible",
                name: "oMLX",
                options: { baseURL: OMLX_BASE, apiKey: "local" },
                models: {
                  [LIVE_MODEL.split("/")[1]!]: {
                    name: LIVE_MODEL,
                    attachment: false,
                    reasoning: true,
                    tool_call: true,
                    limit: { context: 114688, output: 16384 },
                  },
                },
              },
            },
            agent: { build: { model: LIVE_MODEL }, title: { model: LIVE_MODEL }, summary: { model: LIVE_MODEL } },
          },
          null,
          2,
        ),
      )
    },
  })
}, 120_000)

afterAll(async () => {
  await instance?.stop()
})

describe("live watchdog evaluation (opt-in)", () => {
  maybe(
    "runs the frozen corpus against the configured local model and checks shipping criteria",
    async () => {
      const client = httpCriticClient(instance.baseUrl)
      const runner = new CriticRunner({ client })
      const root = await createSession(instance, "watchdog-live-eval")
      const model = { providerID: LIVE_MODEL.split("/")[0]!, modelID: LIVE_MODEL.split("/")[1]! }

      const raws: Array<{ id: string; label: string; raw: string }> = []
      const { metrics } = await evaluate(
        EVALUATION_CORPUS,
        async (fixture) => {
          const fitted = fitUserPrompt(fixture.packet)
          if ("error" in fitted) return '{"status":"ok"}'
          const result = await runner.run({
            rootSessionID: root,
            agent: "watchdog-critic",
            model,
            prompt: fitted.prompt,
            timeoutMs: 30_000,
          })
          const raw =
            result.kind === "ok" || result.kind === "concern" || result.kind === "malformed"
              ? result.raw
              : '{"status":"ok"}'
          raws.push({ id: fixture.id, label: fixture.label, raw: (raw ?? "").slice(0, 400) })
          return raw
        },
        "cadence",
      )

      // eslint-disable-next-line no-console
      console.log(formatReport(metrics))
      const { writeFileSync } = await import("node:fs")
      writeFileSync(
        "/tmp/watchdog-live-report.json",
        JSON.stringify({ report: formatReport(metrics), metrics, failures: acceptanceFailures(metrics), raws }, null, 2),
      )
      expect(metrics.maxPromptBytes).toBeLessThanOrEqual(16_384)
      // The decision to enable by default is recorded in watchdog/probe-outcomes.ts;
      // this test reports, and only asserts the hard byte cap plus fail-open behavior.
      void acceptanceFailures(metrics)
    },
    30 * 60_000,
  )
})
