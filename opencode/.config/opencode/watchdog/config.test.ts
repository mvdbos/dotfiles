/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildCriticAgent, loadWatchdogConfig, parseModelRef, parseWatchdogConfig, WATCHDOG_AGENT_NAME } from "./config"
import { CRITIC_SYSTEM_PROMPT } from "./prompt"
import { MID_RUN_DELIVERY_ENABLED } from "./probe-outcomes"

describe("parseWatchdogConfig", () => {
  test("keeps disabled when the file is absent and requires no model", () => {
    const result = parseWatchdogConfig(undefined)
    expect(result.enabled).toBe(false)
    expect(result.disabledReason).toBe("watchdog.json not found")
    expect(result.config.everyTools).toBe(10)
    expect(result.config.midRunDelivery).toBe(MID_RUN_DELIVERY_ENABLED)
  })

  test("enables a complete config", () => {
    const result = parseWatchdogConfig({
      enabled: true,
      model: "omlx/Qwen3.5-4B-oQ4e-mtp",
      everyTools: 20,
      onIdle: false,
      maxRecentTools: 6,
      timeoutMs: 5000,
      foreignContinuationSettleMs: 250,
      debug: true,
    })
    expect(result.enabled).toBe(true)
    expect(result.disabledReason).toBeUndefined()
    expect(result.config).toMatchObject({
      enabled: true,
      model: "omlx/Qwen3.5-4B-oQ4e-mtp",
      everyTools: 20,
      onIdle: false,
      maxRecentTools: 6,
      timeoutMs: 5000,
      foreignContinuationSettleMs: 250,
      debug: true,
    })
  })

  test("disabled by explicit flag wins over a valid model", () => {
    const result = parseWatchdogConfig({ enabled: false, model: "omlx/Qwen3.5-4B-oQ4e-mtp" })
    expect(result.enabled).toBe(false)
    expect(result.disabledReason).toBeUndefined()
  })

  test("requires a provider/model ref when enabled", () => {
    expect(parseWatchdogConfig({ enabled: true }).disabledReason).toBe("model is required")
    expect(parseWatchdogConfig({ enabled: true, model: "   " }).disabledReason).toBe("model is required")
    expect(parseWatchdogConfig({ enabled: true, model: "qwen" }).disabledReason).toBe(
      "model must use the provider/model form",
    )
    expect(parseWatchdogConfig({ enabled: true, model: "omlx/" }).disabledReason).toBe(
      "model must use the provider/model form",
    )
  })

  test("rejects out-of-range cadence and timeout values", () => {
    const base = { enabled: true, model: "omlx/qwen" }
    expect(parseWatchdogConfig({ ...base, everyTools: 4 }).disabledReason).toBe(
      "everyTools must be an integer between 5 and 100",
    )
    expect(parseWatchdogConfig({ ...base, everyTools: 101 }).disabledReason).toBe(
      "everyTools must be an integer between 5 and 100",
    )
    expect(parseWatchdogConfig({ ...base, maxRecentTools: 3 }).disabledReason).toBe(
      "maxRecentTools must be an integer between 4 and 24",
    )
    expect(parseWatchdogConfig({ ...base, timeoutMs: 999 }).disabledReason).toBe(
      "timeoutMs must be an integer between 1000 and 30000",
    )
    expect(parseWatchdogConfig({ ...base, foreignContinuationSettleMs: 5001 }).disabledReason).toBe(
      "foreignContinuationSettleMs must be an integer between 0 and 5000",
    )
    expect(parseWatchdogConfig({ ...base, everyTools: 10.5 }).disabledReason).toBe(
      "everyTools must be an integer between 5 and 100",
    )
  })

  test("rejects malformed pattern sections but keeps built-ins for valid ones", () => {
    const base = { enabled: true, model: "omlx/qwen" }
    expect(
      parseWatchdogConfig({ ...base, foreignContinuationPatterns: { mode: "sideways" } }).disabledReason,
    ).toBe("foreignContinuationPatterns.mode must be extend or replace")
    expect(
      parseWatchdogConfig({ ...base, foreignContinuationPatterns: { patterns: "nope" } }).disabledReason,
    ).toBe("foreignContinuationPatterns.patterns must be an array")

    const valid = parseWatchdogConfig({
      ...base,
      foreignContinuationPatterns: {
        mode: "replace",
        patterns: [{ id: "custom", startsWith: "Go\n", orderedFragments: ["on"] }],
      },
    })
    expect(valid.enabled).toBe(true)
    expect(valid.config.foreignContinuationPatterns.patterns.map((pattern) => pattern.id)).toEqual(["custom"])
  })

  test("loads from disk and reports invalid JSON clearly", () => {
    const directory = mkdtempSync(join(tmpdir(), "watchdog-config-"))
    const missing = loadWatchdogConfig(join(directory, "missing.json"))
    expect(missing.disabledReason).toBe("watchdog.json not found")

    const invalidPath = join(directory, "invalid.json")
    writeFileSync(invalidPath, "{not json")
    expect(loadWatchdogConfig(invalidPath).disabledReason).toBe("watchdog.json is not valid JSON")

    const goodPath = join(directory, "good.json")
    writeFileSync(goodPath, JSON.stringify({ enabled: true, model: "omlx/qwen" }))
    expect(loadWatchdogConfig(goodPath).enabled).toBe(true)
  })

  test("builds the dedicated hidden critic agent without a step limit", () => {
    const result = parseWatchdogConfig({ enabled: true, model: "omlx/qwen" })
    const agent = buildCriticAgent(result.config)
    expect(WATCHDOG_AGENT_NAME).toBe("watchdog-critic")
    expect(agent).toMatchObject({
      model: "omlx/qwen",
      temperature: 0,
      prompt: CRITIC_SYSTEM_PROMPT,
      hidden: true,
      options: { enable_thinking: false },
      permission: { "*": "deny" },
    })
    expect(agent.steps).toBeUndefined()
  })

  test("parses model refs without fallback", () => {
    expect(parseModelRef("omlx/Qwen3.5-4B-oQ4e-mtp")).toEqual({
      providerID: "omlx",
      modelID: "Qwen3.5-4B-oQ4e-mtp",
    })
  })
})
