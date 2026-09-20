import { readFileSync } from "node:fs"
import {
  compileForeignPatterns,
  type ForeignContinuationMode,
  type ForeignContinuationPattern,
  type ForeignContinuationPatternInput,
} from "../plugin-generated-user/helpers"
import { watchdogConfigPath } from "../plugin-generated-user/config"
import { CRITIC_SYSTEM_PROMPT, OUTPUT_SCHEMA } from "./prompt"
import { MID_RUN_DELIVERY_ENABLED } from "./probe-outcomes"

export const WATCHDOG_AGENT_NAME = "watchdog-critic"
export const PLAN_AGENT_NAME = "plan"

export type WatchdogConfig = {
  enabled: boolean
  model: string
  everyTools: number
  onIdle: boolean
  maxRecentTools: number
  timeoutMs: number
  foreignContinuationSettleMs: number
  foreignContinuationPatterns: {
    mode: ForeignContinuationMode
    patterns: ForeignContinuationPattern[]
  }
  midRunDelivery: boolean
  debug: boolean
}

export type WatchdogConfigResult = {
  config: WatchdogConfig
  enabled: boolean
  disabledReason?: string
  warnings: string[]
}

export const DEFAULT_EVERY_TOOLS = 10
export const DEFAULT_MAX_RECENT_TOOLS = 12
export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_SETTLE_MS = 500
export const MIN_EVERY_TOOLS = 5
export const MAX_EVERY_TOOLS = 100
export const MIN_MAX_RECENT_TOOLS = 4
export const MAX_MAX_RECENT_TOOLS = 24
export const MIN_TIMEOUT_MS = 1_000
export const MAX_TIMEOUT_MS = 30_000
export const MAX_SETTLE_MS = 5_000

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  model: "",
  everyTools: DEFAULT_EVERY_TOOLS,
  onIdle: true,
  maxRecentTools: DEFAULT_MAX_RECENT_TOOLS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  foreignContinuationSettleMs: DEFAULT_SETTLE_MS,
  foreignContinuationPatterns: { mode: "extend", patterns: [] },
  midRunDelivery: MID_RUN_DELIVERY_ENABLED,
  debug: false,
}

export class WatchdogConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchdogConfigError"
  }
}

function integerField(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new WatchdogConfigError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function booleanField(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new WatchdogConfigError(`${name} must be a boolean`)
  return value
}

function modelField(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new WatchdogConfigError("model is required")
  const trimmed = value.trim()
  const separator = trimmed.indexOf("/")
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new WatchdogConfigError("model must use the provider/model form")
  }
  return trimmed
}

function patternSection(value: unknown): { mode: ForeignContinuationMode; patterns: ForeignContinuationPattern[]; warnings: string[] } {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    throw new WatchdogConfigError("foreignContinuationPatterns must be an object")
  }
  const section = (value ?? {}) as { mode?: unknown; patterns?: unknown }
  if (section.mode !== undefined && section.mode !== "extend" && section.mode !== "replace") {
    throw new WatchdogConfigError("foreignContinuationPatterns.mode must be extend or replace")
  }
  if (section.patterns !== undefined && !Array.isArray(section.patterns)) {
    throw new WatchdogConfigError("foreignContinuationPatterns.patterns must be an array")
  }
  const compiled = compileForeignPatterns({
    mode: section.mode,
    patterns: (section.patterns ?? []) as ForeignContinuationPatternInput[],
  })
  return { mode: compiled.mode, patterns: compiled.patterns, warnings: compiled.warnings }
}

export function parseWatchdogConfig(value: unknown): WatchdogConfigResult {
  const warnings: string[] = []
  if (value === undefined) {
    return { config: { ...DEFAULT_WATCHDOG_CONFIG }, enabled: false, disabledReason: "watchdog.json not found", warnings }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      config: { ...DEFAULT_WATCHDOG_CONFIG },
      enabled: false,
      disabledReason: "watchdog.json must contain a JSON object",
      warnings,
    }
  }

  const input = value as Record<string, unknown>
  try {
    const patterns = patternSection(input.foreignContinuationPatterns)
    warnings.push(...patterns.warnings)
    const config: WatchdogConfig = {
      enabled: booleanField(input.enabled, "enabled", false),
      model: modelField(input.model),
      everyTools: integerField(input.everyTools, "everyTools", MIN_EVERY_TOOLS, MAX_EVERY_TOOLS, DEFAULT_EVERY_TOOLS),
      onIdle: booleanField(input.onIdle, "onIdle", DEFAULT_WATCHDOG_CONFIG.onIdle),
      maxRecentTools: integerField(
        input.maxRecentTools,
        "maxRecentTools",
        MIN_MAX_RECENT_TOOLS,
        MAX_MAX_RECENT_TOOLS,
        DEFAULT_MAX_RECENT_TOOLS,
      ),
      timeoutMs: integerField(input.timeoutMs, "timeoutMs", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      foreignContinuationSettleMs: integerField(
        input.foreignContinuationSettleMs,
        "foreignContinuationSettleMs",
        0,
        MAX_SETTLE_MS,
        DEFAULT_SETTLE_MS,
      ),
      foreignContinuationPatterns: { mode: patterns.mode, patterns: patterns.patterns },
      midRunDelivery: booleanField(input.midRunDelivery, "midRunDelivery", MID_RUN_DELIVERY_ENABLED),
      debug: booleanField(input.debug, "debug", false),
    }
    return { config, enabled: config.enabled, warnings }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid watchdog.json"
    return { config: { ...DEFAULT_WATCHDOG_CONFIG }, enabled: false, disabledReason: reason, warnings }
  }
}

export function loadWatchdogConfig(path: string = watchdogConfigPath()): WatchdogConfigResult {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return parseWatchdogConfig(undefined)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      config: { ...DEFAULT_WATCHDOG_CONFIG },
      enabled: false,
      disabledReason: "watchdog.json is not valid JSON",
      warnings: [],
    }
  }
  return parseWatchdogConfig(parsed)
}

export function buildCriticAgent(config: WatchdogConfig): Record<string, unknown> {
  return {
    model: config.model,
    temperature: 0,
    prompt: CRITIC_SYSTEM_PROMPT,
    description: "Internal observation-only trajectory critic.",
    hidden: true,
    options: {
      enable_thinking: false,
      response_format: {
        type: "json_schema",
        json_schema: { name: "watchdog_verdict", strict: true, schema: OUTPUT_SCHEMA },
      },
    },
    permission: { "*": "deny" },
  }
}

export function parseModelRef(model: string): { providerID: string; modelID: string } {
  const separator = model.indexOf("/")
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) }
}
