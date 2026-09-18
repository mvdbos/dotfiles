export type AdmissionPolicy = {
  timeoutMs: number
  timeoutMessage: string
}

const policies: Record<string, AdmissionPolicy> = {
  explore: {
    timeoutMs: 60_000,
    timeoutMessage:
      "Exploration was not started: the local explore worker remained busy for the admission timeout. Its completion time is unknown. Do not immediately retry or poll. If an already-running exploration covers this question, use its result when available. Otherwise continue independent work, or perform a small targeted lookup yourself with your own tools; prefer relevant files and narrow searches to limit parent-context growth.",
  },
  general: {
    timeoutMs: 600_000,
    timeoutMessage:
      "The general task was not started: another general worker remained busy for the admission timeout. Its completion time is unknown. Do not immediately retry or poll. Continue independent, non-overlapping work or wait for the existing task result.",
  },
}

export function timeoutEnvironmentName(agent: string) {
  return `OPENCODE_SUBAGENT_${agent.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_TIMEOUT_MS`
}

function configuredTimeout(agent: string, fallback: number) {
  const value = Number(process.env[timeoutEnvironmentName(agent)])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export function admissionPolicy(agent: string): AdmissionPolicy | undefined {
  if (!Object.hasOwn(policies, agent)) return
  const policy = policies[agent]
  return { ...policy, timeoutMs: configuredTimeout(agent, policy.timeoutMs) }
}

export function controlledSubagent(agent: string) {
  return Object.hasOwn(policies, agent)
}
