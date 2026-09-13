/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { MlxServeLoopRetryPlugin } from "../plugins/mlx-serve-loop-retry"

async function captureLogs(options: Record<string, unknown> | undefined) {
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "))
  }
  try {
    await MlxServeLoopRetryPlugin({ client: {} } as never, options)
  } finally {
    console.error = original
  }
  return lines
}

describe("MlxServeLoopRetryPlugin options", () => {
  test("missing options use defaults without logging", async () => {
    expect(await captureLogs(undefined)).toEqual([])
  })

  test("invalid options log once and fall back to defaults", async () => {
    const lines = await captureLogs({ retries: -1, provider: 42 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('"event":"invalid-options"')
    expect(lines[0]).toContain('"retries":3')
    expect(lines[0]).toContain('"provider":"mlx-serve"')
  })

  test("retries: 0 logs disabled", async () => {
    const lines = await captureLogs({ retries: 0 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('"event":"disabled"')
  })
})
