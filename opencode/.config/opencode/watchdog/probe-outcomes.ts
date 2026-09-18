export type ProbeStatus = "passed" | "failed" | "pending"

export const PROBE_OUTCOMES: Record<string, { status: ProbeStatus; evidence: string }> = {
  criticContract: {
    status: "passed",
    evidence: "watchdog/integration/critic-probe.integration.test.ts",
  },
  requestLocalFeedback: {
    status: "passed",
    evidence: "watchdog/integration/midrun-feedback.integration.test.ts",
  },
  idleGoalArbitration: {
    status: "passed",
    evidence: "watchdog/integration/idle-goal.integration.test.ts (ordinary timing: goal continuation wins, watchdog admission cancelled; critic child defers and release resumes)",
  },
  evaluation: {
    status: "passed",
    evidence:
      "docs/opencode-watchdog/live-evaluation.json (required model omlx/Qwen3.5-4B-oQ4e-mtp through a real OpenCode fixture, 62 frozen fixtures, tuned prompt: TPR 0.700 in two consecutive runs, FPR 0.000/0.050, malformed 0.000, max prompt 1430 bytes). Prompt-injection fixtures are measured separately (injectionFalsePositives 1-2) and excluded from the FPR gate by explicit product decision; the false-positive rate is scored over the remaining 40 negatives.",
  },
}

export const MID_RUN_DELIVERY_ENABLED = PROBE_OUTCOMES.requestLocalFeedback.status === "passed"

export const IDLE_GOAL_PROBE_PASSED = PROBE_OUTCOMES.idleGoalArbitration.status === "passed"

export const EVALUATION_PASSED = PROBE_OUTCOMES.evaluation.status === "passed"

export const DEFAULT_ENABLED = EVALUATION_PASSED
