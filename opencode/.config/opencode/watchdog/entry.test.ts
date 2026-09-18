/// <reference path="../explore-controls/bun-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WatchdogPlugin } from "../plugins/watchdog"

const originalWarn = console.warn

afterEach(() => {
  console.warn = originalWarn
  delete process.env.OPENCODE_WATCHDOG_CONFIG
})

function captureWarnings(): string[] {
  const messages: string[] = []
  console.warn = ((...args: unknown[]) => {
    messages.push(args.map((value) => String(value)).join(" "))
  }) as typeof console.warn
  return messages
}

function configFile(content: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "watchdog-entry-")), "watchdog.json")
  writeFileSync(path, JSON.stringify(content))
  process.env.OPENCODE_WATCHDOG_CONFIG = path
  return path
}

describe("watchdog plugin entry", () => {
  test("stays silent when review is explicitly disabled", async () => {
    configFile({ enabled: false, model: "omlx/Qwen3.5-4B-oQ4e-mtp" })
    const warnings = captureWarnings()
    const hooks = await WatchdogPlugin({} as never)
    expect(warnings).toEqual([])
    expect(hooks).toEqual({})
  })

  test("reports one bounded reason for invalid configuration and stays disabled", async () => {
    configFile({ enabled: true, model: "not-a-model" })
    const warnings = captureWarnings()
    const hooks = await WatchdogPlugin({} as never)
    expect(warnings).toEqual(["[watchdog] model must use the provider/model form "])
    expect(hooks).toEqual({})
  })

  test("reports a missing configuration file", async () => {
    process.env.OPENCODE_WATCHDOG_CONFIG = join(mkdtempSync(join(tmpdir(), "watchdog-entry-")), "absent.json")
    const warnings = captureWarnings()
    const hooks = await WatchdogPlugin({} as never)
    expect(warnings).toEqual(["[watchdog] watchdog.json not found "])
    expect(hooks).toEqual({})
  })
})
