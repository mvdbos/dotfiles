import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadTodoReconcileConfig } from "../src/config"
import { DEFAULT_NUDGE_CONFIG } from "../src/nudge"

const dir = mkdtempSync(path.join(tmpdir(), "todo-reconcile-config-"))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function writeConfig(name: string, contents: string): string {
  const file = path.join(dir, name)
  writeFileSync(file, contents)
  return file
}

describe("loadTodoReconcileConfig", () => {
  test("falls back to documented defaults when no file exists", () => {
    const config = loadTodoReconcileConfig([path.join(dir, "missing.json")])
    expect(config.nudge).toEqual(DEFAULT_NUDGE_CONFIG)
    expect(config.warnings).toEqual([])
  })

  test("reads valid values and ignores unrelated keys", () => {
    const file = writeConfig(
      "valid.json",
      JSON.stringify({
        nudge: { enabled: false, toolThreshold: 20, minutesThreshold: 0, includeList: true, maxListBytes: 2_048 },
        other: 1,
      }),
    )
    const config = loadTodoReconcileConfig([file])
    expect(config.nudge).toEqual({
      enabled: false,
      toolThreshold: 20,
      minutesThreshold: 0,
      includeList: true,
      maxListBytes: 2_048,
    })
    expect(config.warnings).toEqual([])
  })

  test("falls back per invalid field and warns", () => {
    const file = writeConfig(
      "invalid-fields.json",
      JSON.stringify({ nudge: { toolThreshold: -5, includeList: "yes", maxListBytes: 12 } }),
    )
    const config = loadTodoReconcileConfig([file])
    expect(config.nudge.toolThreshold).toBe(DEFAULT_NUDGE_CONFIG.toolThreshold)
    expect(config.nudge.includeList).toBe(DEFAULT_NUDGE_CONFIG.includeList)
    expect(config.nudge.maxListBytes).toBe(DEFAULT_NUDGE_CONFIG.maxListBytes)
    expect(config.warnings).toHaveLength(3)
  })

  test("disables nudging when both triggers are zero", () => {
    const file = writeConfig("no-trigger.json", JSON.stringify({ nudge: { toolThreshold: 0, minutesThreshold: 0 } }))
    const config = loadTodoReconcileConfig([file])
    expect(config.nudge.enabled).toBe(false)
    expect(config.warnings.some((warning) => warning.includes("no active trigger"))).toBe(true)
  })

  test("reports invalid JSON without throwing", () => {
    const file = writeConfig("broken.json", "{ nudge: ")
    const config = loadTodoReconcileConfig([file])
    expect(config.nudge).toEqual(DEFAULT_NUDGE_CONFIG)
    expect(config.warnings.length).toBeGreaterThan(0)
  })
})
