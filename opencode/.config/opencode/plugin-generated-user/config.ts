import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  compileForeignPatterns,
  type CompiledForeignPatterns,
  type ForeignContinuationConfig,
} from "./helpers"

export function watchdogConfigPath(): string {
  return process.env.OPENCODE_WATCHDOG_CONFIG ?? fileURLToPath(new URL("../watchdog.json", import.meta.url))
}

export type UserClassifierConfig = {
  patterns: CompiledForeignPatterns
  warnings: string[]
}

function readForeignSection(path: string): ForeignContinuationConfig | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const section = parsed?.foreignContinuationPatterns
    if (!section || typeof section !== "object") return undefined
    return section as ForeignContinuationConfig
  } catch {
    return undefined
  }
}

export function loadUserClassifierConfig(path: string = watchdogConfigPath()): UserClassifierConfig {
  const compiled = compileForeignPatterns(readForeignSection(path))
  return { patterns: compiled, warnings: compiled.warnings }
}
