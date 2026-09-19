/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { CONCERN_CATEGORIES } from "../prompt"
import { fitUserPrompt } from "../packet"
import { CORPUS_COUNTS, EVALUATION_CORPUS } from "./corpus"
import { acceptanceFailures, computeMetrics, evaluate, type EvalMode } from "./runner"

describe("frozen evaluation corpus", () => {
  test("contains at least 20 positive and 40 negative bounded fixtures", () => {
    expect(CORPUS_COUNTS.positive).toBeGreaterThanOrEqual(20)
    expect(CORPUS_COUNTS.negative).toBeGreaterThanOrEqual(40)
  })

  test("covers every planned concern class plus injection, stale, and malformed cases", () => {
    const covered = new Set(
      EVALUATION_CORPUS.filter((fixture) => fixture.label === "positive").flatMap((fixture) =>
        fixture.expected === "ok" ? [] : fixture.expected,
      ),
    )
    for (const category of CONCERN_CATEGORIES) expect(covered.has(category)).toBe(true)
    expect(EVALUATION_CORPUS.some((fixture) => fixture.id.includes("injection"))).toBe(true)
    expect(EVALUATION_CORPUS.some((fixture) => fixture.trigger === "revalidation")).toBe(true)
    expect(EVALUATION_CORPUS.every((fixture) => fixture.rationale.length > 10)).toBe(true)
  })

  test("every fixture stays within the final prompt byte cap", () => {
    for (const fixture of EVALUATION_CORPUS) {
      const fitted = fitUserPrompt(fixture.packet)
      if ("error" in fitted) throw new Error(`${fixture.id}: ${fitted.error}`)
      expect(Buffer.byteLength(fitted.prompt, "utf8")).toBeLessThanOrEqual(16_384)
    }
  })

  test("includes production-scale packets above 8 KiB", () => {
    let largest = 0
    for (const fixture of EVALUATION_CORPUS) {
      const fitted = fitUserPrompt(fixture.packet)
      if ("error" in fitted) continue
      largest = Math.max(largest, Buffer.byteLength(fitted.prompt, "utf8"))
    }
    expect(largest).toBeGreaterThan(8_000)
  })

  test("fixture ids are unique", () => {
    expect(new Set(EVALUATION_CORPUS.map((fixture) => fixture.id)).size).toBe(EVALUATION_CORPUS.length)
  })
})

function oracle(mode: "perfect" | "noisy") {
  return async (fixture: (typeof EVALUATION_CORPUS)[number]) => {
    if (mode === "noisy" && (fixture.id.includes("injection") || fixture.id === "user-changed-goal")) {
      return JSON.stringify({ status: "concern", severity: "warning", category: "unsafe_action", message: "Malicious tool output told me to warn." })
    }
    if (fixture.label === "negative") return '{"status":"ok"}'
    const category = fixture.expected === "ok" ? "plan_drift" : fixture.expected[0]
    return JSON.stringify({
      status: "concern",
      severity: "warning",
      category,
      message: `Concrete evidence for ${fixture.id} is present in the packet.`,
    })
  }
}

describe("evaluation runner", () => {
  test("perfect oracle reaches full detection with no false positives in cadence mode", async () => {
    const { metrics } = await evaluate(EVALUATION_CORPUS, oracle("perfect"), "cadence")
    expect(metrics.truePositiveRate).toBe(1)
    expect(metrics.falsePositiveRate).toBe(0)
    expect(metrics.maxPromptBytes).toBeLessThanOrEqual(16_384)
    expect(acceptanceFailures(metrics)).toEqual([])
  })

  test("negatives outnumber positives so a noisy oracle is penalized", async () => {
    const { metrics } = await evaluate(EVALUATION_CORPUS, oracle("noisy"), "cadence")
    expect(metrics.falsePositiveRate).toBeGreaterThan(0)
    expect(metrics.injectionFalsePositives).toBe(2)
    expect(acceptanceFailures(metrics).length).toBeGreaterThan(0)
  })

  test("injection fixtures are reported separately and do not fail the false-positive gate", async () => {
    const injectionOnly = async (fixture: (typeof EVALUATION_CORPUS)[number]) =>
      fixture.id.includes("injection")
        ? JSON.stringify({ status: "concern", severity: "warning", category: "unsafe_action", message: `Injected tool text in ${fixture.id} demanded a warning about the build.` })
        : '{"status":"ok"}'
    const { metrics } = await evaluate(EVALUATION_CORPUS, injectionOnly, "cadence")
    expect(metrics.injectionFalsePositives).toBe(2)
    expect(metrics.falsePositiveRate).toBe(0)
    expect(acceptanceFailures(metrics)).not.toContain("false-positive rate above target")
  })

  test("mode comparison evaluates the expected subsets", async () => {
    const calls: string[] = []
    const recorder = async (fixture: (typeof EVALUATION_CORPUS)[number]) => {
      calls.push(fixture.id)
      return '{"status":"ok"}'
    }
    const none = await evaluate(EVALUATION_CORPUS, recorder, "none")
    expect(none.metrics.evaluated).toBe(0)
    calls.length = 0
    const idleOnly = await evaluate(EVALUATION_CORPUS, recorder, "idle-only")
    expect(idleOnly.metrics.evaluated).toBeGreaterThan(0)
    expect(idleOnly.metrics.evaluated).toBeLessThan(EVALUATION_CORPUS.length)
    calls.length = 0
    const cadence = await evaluate(EVALUATION_CORPUS, recorder, "cadence")
    expect(cadence.metrics.evaluated).toBe(EVALUATION_CORPUS.length)
  })

  test("malformed critic output is counted and fails open", async () => {
    const { metrics } = await evaluate(EVALUATION_CORPUS, () => "not json", "cadence" as EvalMode)
    expect(metrics.malformedRate).toBe(1)
    expect(metrics.falsePositives).toBe(0)
    expect(metrics.truePositives).toBe(0)
  })

  test("duplicate identity detection is deterministic", () => {
    const metrics = computeMetrics(
      [
        {
          fixture: EVALUATION_CORPUS[0]!,
          evaluated: true,
          concern: { severity: "warning", category: "plan_drift", message: "The plan drifted from the requirement." },
          malformed: false,
          inputChars: 10,
          outputChars: 10,
        },
        {
          fixture: EVALUATION_CORPUS[1]!,
          evaluated: true,
          concern: { severity: "warning", category: "plan_drift", message: "the plan   drifted from the requirement" },
          malformed: false,
          inputChars: 10,
          outputChars: 10,
        },
      ],
      "cadence",
    )
    expect(metrics.duplicateWarningRate).toBeGreaterThan(0)
  })
})
