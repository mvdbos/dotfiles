/**
 * Optional sidecar configuration for todo-reconcile.
 *
 * Resolution order: `OPENCODE_TODO_RECONCILE_CONFIG`, then `todo-reconcile.json`
 * next to `opencode.json` (standalone bundle) or at the config root (source
 * layout). Missing files and invalid fields fall back to defaults and report
 * a concise warning at plugin start.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DEFAULT_NUDGE_CONFIG, type NudgeConfig } from "./nudge"

export type TodoReconcileConfig = {
  nudge: NudgeConfig
  warnings: string[]
}

export function todoReconcileConfigPaths(): string[] {
  const override = process.env.OPENCODE_TODO_RECONCILE_CONFIG
  if (override) return [override]
  return [
    // Standalone bundle: <config-dir>/plugins/todo-reconcile.js
    fileURLToPath(new URL("../todo-reconcile.json", import.meta.url)),
    // Source layout: <config-dir>/todo-reconcile/src/config.ts
    fileURLToPath(new URL("../../todo-reconcile.json", import.meta.url)),
  ]
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number | undefined {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const rounded = Math.floor(value)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

function parseNudge(section: unknown, warnings: string[]): NudgeConfig {
  const nudge: NudgeConfig = { ...DEFAULT_NUDGE_CONFIG }
  if (section === undefined) return nudge
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    warnings.push("nudge config was not an object; using defaults")
    return nudge
  }
  const raw = section as Record<string, unknown>

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") nudge.enabled = raw.enabled
    else warnings.push("nudge.enabled was not a boolean; using default")
  }

  const toolThreshold = boundedInteger(raw.toolThreshold, DEFAULT_NUDGE_CONFIG.toolThreshold, 0, 1_000)
  if (toolThreshold === undefined) {
    warnings.push("nudge.toolThreshold must be an integer between 0 and 1000; using default")
  } else {
    nudge.toolThreshold = toolThreshold
  }

  const minutesThreshold = boundedInteger(raw.minutesThreshold, DEFAULT_NUDGE_CONFIG.minutesThreshold, 0, 1_440)
  if (minutesThreshold === undefined) {
    warnings.push("nudge.minutesThreshold must be an integer between 0 and 1440; using default")
  } else {
    nudge.minutesThreshold = minutesThreshold
  }

  if (nudge.enabled && nudge.toolThreshold === 0 && nudge.minutesThreshold === 0) {
    warnings.push("nudge has no active trigger (toolThreshold and minutesThreshold are both 0); nudges disabled")
    nudge.enabled = false
  }
  return nudge
}

export function loadTodoReconcileConfig(paths: string[] = todoReconcileConfigPaths()): TodoReconcileConfig {
  const warnings: string[] = []
  const path = paths.find((candidate) => existsSync(candidate))
  if (!path) return { nudge: { ...DEFAULT_NUDGE_CONFIG }, warnings }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  } catch {
    warnings.push(`todo-reconcile config ${path} is not valid JSON; using defaults`)
    return { nudge: { ...DEFAULT_NUDGE_CONFIG }, warnings }
  }

  return { nudge: parseNudge(parsed?.nudge, warnings), warnings }
}
