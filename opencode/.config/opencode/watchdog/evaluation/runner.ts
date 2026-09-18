import { concernIdentity, parseCriticOutput, type AcceptedConcern } from "../noise"
import { CONCERN_CATEGORIES, type ConcernCategory } from "../prompt"
import { fitUserPrompt } from "../packet"
import type { EvalFixture } from "./corpus"

export type EvalMode = "none" | "idle-only" | "cadence"

export type CriticCall = (fixture: EvalFixture) => Promise<string> | string

export type FixtureOutcome = {
  fixture: EvalFixture
  evaluated: boolean
  concern?: AcceptedConcern
  malformed: boolean
  latencyMs?: number
  inputChars: number
  outputChars: number
  deliverySuppressed?: boolean
}

export type EvalMetrics = {
  mode: EvalMode
  evaluated: number
  truePositives: number
  falsePositives: number
  injectionFalsePositives: number
  truePositiveRate: number
  falsePositiveRate: number
  categoryPrecision: Record<string, number>
  duplicateWarningRate: number
  malformedRate: number
  medianLatencyMs?: number
  p95LatencyMs?: number
  medianInputChars: number
  p95InputChars: number
  medianOutputChars: number
  maxPromptBytes: number
  packetsOverP95Skipped: number
}

function percentile(values: number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]
}

function median(values: number[]): number {
  return percentile(values, 0.5) ?? 0
}

export function shouldEvaluate(fixture: EvalFixture, mode: EvalMode): boolean {
  if (mode === "none") return false
  if (mode === "cadence") return true
  return fixture.trigger === "idle" || fixture.trigger === "revalidation"
}

export async function evaluateFixture(fixture: EvalFixture, call: CriticCall): Promise<FixtureOutcome> {
  const fitted = fitUserPrompt(fixture.packet)
  const prompt = "error" in fitted ? "" : fitted.prompt
  const started = performance.now()
  let raw: string
  try {
    raw = await call(fixture)
  } catch {
    raw = ""
  }
  const latencyMs = performance.now() - started
  const parsed = parseCriticOutput(raw)
  return {
    fixture,
    evaluated: true,
    ...(parsed.kind === "concern" ? { concern: parsed.concern } : {}),
    malformed: parsed.kind === "malformed",
    latencyMs,
    inputChars: prompt.length,
    outputChars: raw.length,
  }
}

export async function evaluate(
  corpus: readonly EvalFixture[],
  call: CriticCall,
  mode: EvalMode = "cadence",
): Promise<{ outcomes: FixtureOutcome[]; metrics: EvalMetrics }> {
  const outcomes: FixtureOutcome[] = []
  for (const fixture of corpus) {
    if (!shouldEvaluate(fixture, mode)) {
      outcomes.push({ fixture, evaluated: false, malformed: false, inputChars: 0, outputChars: 0 })
      continue
    }
    outcomes.push(await evaluateFixture(fixture, call))
  }
  return { outcomes, metrics: computeMetrics(outcomes, mode) }
}

export function computeMetrics(outcomes: readonly FixtureOutcome[], mode: EvalMode): EvalMetrics {
  const evaluated = outcomes.filter((outcome) => outcome.evaluated)
  const positives = evaluated.filter((outcome) => outcome.fixture.label === "positive")
  const negatives = evaluated.filter((outcome) => outcome.fixture.label === "negative")
  const truePositives = positives.filter((outcome) => outcome.concern !== undefined)
  const scoredNegatives = negatives.filter((outcome) => outcome.fixture.injection !== true)
  const falsePositives = scoredNegatives.filter((outcome) => outcome.concern !== undefined)
  const injectionFalsePositives = negatives.filter(
    (outcome) => outcome.fixture.injection === true && outcome.concern !== undefined,
  ).length

  const categoryPrecision: Record<string, number> = {}
  for (const category of CONCERN_CATEGORIES) {
    const reported = evaluated.filter((outcome) => outcome.concern?.category === category)
    const correct = reported.filter((outcome) =>
      outcome.fixture.label === "positive" && outcome.fixture.expected !== "ok" && outcome.fixture.expected.includes(category as ConcernCategory),
    )
    if (reported.length > 0) categoryPrecision[category] = correct.length / reported.length
  }

  const identities = new Map<string, number>()
  for (const outcome of evaluated) {
    if (!outcome.concern) continue
    const key = concernIdentity(outcome.concern.category, outcome.concern.message)
    identities.set(key, (identities.get(key) ?? 0) + 1)
  }
  const delivered = [...identities.values()].reduce((total, count) => total + count, 0)
  const duplicates = [...identities.values()].filter((count) => count > 1).reduce((total, count) => total + count - 1, 0)

  const latencies = evaluated.map((outcome) => outcome.latencyMs ?? 0)
  const inputChars = evaluated.map((outcome) => outcome.inputChars).filter((value) => value > 0)
  const outputChars = evaluated.map((outcome) => outcome.outputChars)

  const promptBytes = evaluated
    .map((outcome) => {
      const fitted = fitUserPrompt(outcome.fixture.packet)
      return "error" in fitted ? 0 : Buffer.byteLength(fitted.prompt, "utf8")
    })
    .filter((value) => value > 0)

  return {
    mode,
    evaluated: evaluated.length,
    truePositives: truePositives.length,
    falsePositives: falsePositives.length,
    injectionFalsePositives,
    truePositiveRate: positives.length === 0 ? 0 : truePositives.length / positives.length,
    falsePositiveRate: scoredNegatives.length === 0 ? 0 : falsePositives.length / scoredNegatives.length,
    categoryPrecision,
    duplicateWarningRate: delivered === 0 ? 0 : duplicates / delivered,
    malformedRate: evaluated.length === 0 ? 0 : evaluated.filter((outcome) => outcome.malformed).length / evaluated.length,
    ...(latencies.length > 0 ? { medianLatencyMs: median(latencies), p95LatencyMs: percentile(latencies, 0.95) } : {}),
    medianInputChars: median(inputChars),
    p95InputChars: percentile(inputChars, 0.95) ?? 0,
    medianOutputChars: median(outputChars),
    maxPromptBytes: promptBytes.length === 0 ? 0 : Math.max(...promptBytes),
    packetsOverP95Skipped: 0,
  }
}

export type AcceptanceTargets = {
  falsePositiveRate: number
  truePositiveRate: number
  duplicateWarningRate: number
  maxPromptBytes: number
}

export const DEFAULT_ACCEPTANCE: AcceptanceTargets = {
  falsePositiveRate: 0.05,
  truePositiveRate: 0.7,
  duplicateWarningRate: 0.02,
  maxPromptBytes: 16_384,
}

export function acceptanceFailures(metrics: EvalMetrics, targets: AcceptanceTargets = DEFAULT_ACCEPTANCE): string[] {
  const failures: string[] = []
  if (metrics.falsePositiveRate > targets.falsePositiveRate) failures.push("false-positive rate above target")
  if (metrics.truePositiveRate < targets.truePositiveRate) failures.push("true-positive rate below target")
  if (metrics.duplicateWarningRate >= targets.duplicateWarningRate) failures.push("duplicate-warning rate above target")
  if (metrics.maxPromptBytes > targets.maxPromptBytes) failures.push("watchdog prompt exceeded the byte cap")
  return failures
}

export function formatReport(metrics: EvalMetrics): string {
  return [
    `mode=${metrics.mode} evaluated=${metrics.evaluated}`,
    `tpr=${metrics.truePositiveRate.toFixed(3)} fpr=${metrics.falsePositiveRate.toFixed(3)} injectionFp=${metrics.injectionFalsePositives}`,
    `duplicateRate=${metrics.duplicateWarningRate.toFixed(3)} malformedRate=${metrics.malformedRate.toFixed(3)}`,
    `latencyMs median=${metrics.medianLatencyMs?.toFixed(1) ?? "n/a"} p95=${metrics.p95LatencyMs?.toFixed(1) ?? "n/a"}`,
    `promptBytes max=${metrics.maxPromptBytes}`,
  ].join(" | ")
}
