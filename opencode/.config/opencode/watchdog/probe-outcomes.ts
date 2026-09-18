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
    status: "failed",
    evidence:
      "docs/opencode-watchdog/live-evaluation.json (omlx/Qwen3.5-4B-oQ4e-mtp, 62 fixtures: TPR 0.000 < 0.70, FPR 0.000, malformed 0.000, prompt max 1430 bytes) -> watchdog stays disabled by default",
  },
}

export const MID_RUN_DELIVERY_ENABLED = PROBE_OUTCOMES.requestLocalFeedback.status === "passed"

export const IDLE_GOAL_PROBE_PASSED = PROBE_OUTCOMES.idleGoalArbitration.status === "passed"

export const EVALUATION_PASSED = PROBE_OUTCOMES.evaluation.status === "passed"

export const DEFAULT_ENABLED = false
