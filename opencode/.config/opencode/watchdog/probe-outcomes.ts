export type ProbeStatus = "passed" | "failed" | "pending"

export const PROBE_OUTCOMES: Record<string, { status: ProbeStatus; evidence: string }> = {
  criticContract: {
    status: "passed",
    evidence: "watchdog/integration/critic-probe.integration.test.ts",
  },
  cachePreservingFeedback: {
    status: "passed",
    evidence: "watchdog/integration/guarded-idle.integration.test.ts",
  },
  idleGoalArbitration: {
    status: "passed",
    evidence: "watchdog/integration/idle-goal.integration.test.ts (ordinary timing: goal continuation wins, watchdog admission cancelled; critic child defers and release resumes)",
  },
  evaluation: {
    status: "passed",
    evidence:
      "docs/opencode-watchdog/live-evaluation.json (required model omlx/Qwen3.5-4B-oQ4e-mtp through a real OpenCode fixture, 65 frozen fixtures including production-scale packets up to ~11 KiB, compact critic prompt plus json_schema response_format and temperature 0, malformed counted from raw critic output: TPR 0.762/0.762 in two consecutive runs, FPR 0.024/0.048, malformed 0.000, max prompt 10,721 bytes). Prompt-injection fixtures are measured separately (injectionFalsePositives 2) and excluded from the FPR gate by explicit product decision; the false-positive rate is scored over the remaining 42 negatives.",
  },
}

export const MID_RUN_DELIVERY_ENABLED = PROBE_OUTCOMES.cachePreservingFeedback.status === "passed"

export const IDLE_GOAL_PROBE_PASSED = PROBE_OUTCOMES.idleGoalArbitration.status === "passed"

export const EVALUATION_PASSED = PROBE_OUTCOMES.evaluation.status === "passed"

export const DEFAULT_ENABLED = EVALUATION_PASSED
