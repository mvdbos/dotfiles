/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import {
  assistantMessages,
  cleanupAll,
  createSession,
  messageText,
  messages,
  OPENCODE_BIN,
  pluginEvents,
  promptAsync,
  startInstance,
  userMessages,
  waitFor,
  type Instance,
} from "./harness"

const MLX_SERVE_URL = process.env.MLX_SERVE_URL ?? "http://127.0.0.1:11234/v1"
const LOOP_PROMPT =
  "banana ".repeat(120).trim() + "\nContinue the pattern above forever. Do not stop, never change the word."

const binAvailable = existsSync(OPENCODE_BIN)

async function mlxServeModel(): Promise<string | undefined> {
  if (process.env.MLX_SERVE_MODEL) return process.env.MLX_SERVE_MODEL
  if (!binAvailable) return undefined
  try {
    const response = await fetch(`${MLX_SERVE_URL}/models`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return undefined
    const payload = (await response.json()) as { data?: Array<{ id?: string; loaded?: boolean }> }
    const models = payload.data ?? []
    return (models.find((model) => model.loaded && model.id) ?? models.find((model) => model.id))?.id
  } catch {
    return undefined
  }
}

// Live model output is stochastic: it may answer without looping at all, so this
// test only runs when explicitly requested and only asserts detection + retry.
const enabled = process.env.MLX_SERVE_LIVE === "1"
const modelID = enabled ? await mlxServeModel() : undefined
const maybe = enabled && modelID ? test : test.skip

const live: Instance[] = []

afterEach(async () => {
  await cleanupAll(live.splice(0))
})

describe("live mlx-serve repetition loop", () => {
  maybe(
    "detects a real repetition_loop and retries the turn",
    async () => {
      const instance = await startInstance({
        provider: {
          id: "mlx-serve",
          modelID: modelID!,
          baseURL: MLX_SERVE_URL,
          name: "MLX Serve (live)",
          apiKey: "mlx-serve",
          model: {
            name: modelID!,
            tool_call: true,
            limit: { context: 262_144, output: 32_768 },
          },
        },
        retries: 1,
        agentExtra: { title: { disable: true } },
      })
      live.push(instance)

      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, LOOP_PROMPT)

      const list = await waitFor(
        "live retry chain to settle",
        async () => {
          const events = pluginEvents(instance)
          if (!events.includes("retry-started")) return undefined
          if (events.includes("retry-failed") || events.includes("retry-dropped")) return await messages(instance, sessionID)
          const current = await messages(instance, sessionID)
          const last = assistantMessages(current).at(-1)
          if (!last?.info.time?.completed) return undefined
          if (events.includes("exhausted") || last.info.finish === "stop") return current
          return undefined
        },
        120_000,
      )

      const events = pluginEvents(instance)
      expect(events.filter((event) => event === "loop-detected").length).toBeGreaterThanOrEqual(1)
      expect(events.filter((event) => event === "retry-started")).toHaveLength(1)
      expect(events).not.toContain("retry-failed")
      expect(events).not.toContain("retry-dropped")

      expect(userMessages(list)).toHaveLength(1)
      const assistants = assistantMessages(list)
      expect(assistants.length).toBeGreaterThanOrEqual(1)
      const final = assistants[assistants.length - 1]!
      if (events.includes("exhausted")) {
        expect(final.info.finish).toBe("length")
        expect(messageText(final)).toContain("banana")
      } else {
        expect(final.info.finish).toBe("stop")
      }
    },
    240_000,
  )
})
