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
      "docs/opencode-watchdog/live-evaluation.json (omlx/Qwen3.6-35B-A3B-Uncensored-Heretic-MLX-6bit through a real OpenCode fixture, 62 frozen fixtures: TPR 0.700-0.800, FPR 0.000-0.024, malformed 0.000, max prompt 1430 bytes; watchdog-critic step limit removed because steps:1 injected a MAXIMUM STEPS REACHED notice into every critic request)",
  },
}

export const MID_RUN_DELIVERY_ENABLED = PROBE_OUTCOMES.requestLocalFeedback.status === "passed"

export const IDLE_GOAL_PROBE_PASSED = PROBE_OUTCOMES.idleGoalArbitration.status === "passed"

export const EVALUATION_PASSED = PROBE_OUTCOMES.evaluation.status === "passed"

export const DEFAULT_ENABLED = EVALUATION_PASSED
