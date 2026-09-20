export type ProbeExpectation = "task:explore" | "task:general" | "question" | "none"

export type ProbeCue = {
  id: string
  expectation: ProbeExpectation
  forbidden: ProbeExpectation[]
  prompt: string
}

export type ProbeMessagePart = Record<string, any>
export type ProbeMessage = { info?: Record<string, any>; parts?: ProbeMessagePart[] }

export type TaskCall = { subagent: string; description?: string; status: string }
export type QuestionCall = { header?: string; status: string }

export type RunEvidence = {
  assistantText: boolean
  completed: boolean
  taskCalls: TaskCall[]
  questionCalls: QuestionCall[]
}

export type ProbeRun = {
  cue: string
  repetition: number
  sessionID: string
  elapsedMs: number
  timedOut: boolean
  aborted: boolean
  evidence: RunEvidence
}

function toolParts(messages: ProbeMessage[], tool: string): ProbeMessagePart[] {
  return messages.flatMap((message) =>
    (message.parts ?? []).filter((part) => part.type === "tool" && part.tool === tool),
  )
}

export function evidenceOf(messages: ProbeMessage[]): RunEvidence {
  const assistants = messages.filter((message) => message.info?.role === "assistant")
  const assistantText = assistants.some((message) =>
    (message.parts ?? []).some(
      (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
    ),
  )
  const last = assistants.at(-1)
  const completed = Boolean(last?.info?.time?.completed)
  const taskCalls = toolParts(messages, "task").map((part) => {
    const input = part.state?.input ?? part.input ?? {}
    return {
      subagent: String(input.subagent_type ?? "unknown"),
      description: typeof input.description === "string" ? input.description : undefined,
      status: String(part.state?.status ?? "unknown"),
    }
  })
  const questionCalls = toolParts(messages, "question").map((part) => {
    const input = part.state?.input ?? part.input ?? {}
    const first = Array.isArray(input.questions) ? input.questions[0] : undefined
    return {
      header: typeof first?.header === "string" ? first.header : undefined,
      status: String(part.state?.status ?? "unknown"),
    }
  })
  return { assistantText, completed, taskCalls, questionCalls }
}

export function matchesExpectation(evidence: RunEvidence, expectation: ProbeExpectation): boolean {
  switch (expectation) {
    case "task:explore":
      return evidence.taskCalls.some((call) => call.subagent === "explore")
    case "task:general":
      return evidence.taskCalls.some((call) => call.subagent === "general")
    case "question":
      return evidence.questionCalls.length > 0
    case "none":
      return evidence.taskCalls.length === 0 && evidence.questionCalls.length === 0
  }
}

export function outcomeLabel(evidence: RunEvidence): string {
  const labels = evidence.taskCalls.map((call) => `task:${call.subagent}`)
  if (evidence.questionCalls.length > 0) labels.push("question")
  if (labels.length === 0) labels.push(evidence.assistantText ? "direct" : "no-output")
  return [...new Set(labels)].join("+")
}

export function runPasses(cue: ProbeCue, run: ProbeRun): boolean {
  if (!matchesExpectation(run.evidence, cue.expectation)) return false
  if (cue.forbidden.some((expectation) => matchesExpectation(run.evidence, expectation))) return false
  if (cue.expectation === "none" && !run.evidence.completed) return false
  return true
}

export type CueSummary = {
  id: string
  expectation: ProbeExpectation
  runs: number
  passes: number
  observed: Record<string, number>
  majority: boolean
}

export function summarize(cues: ProbeCue[], runs: ProbeRun[]): CueSummary[] {
  return cues.map((cue) => {
    const cueRuns = runs.filter((candidate) => candidate.cue === cue.id)
    const observed: Record<string, number> = {}
    for (const run of cueRuns) {
      const label = outcomeLabel(run.evidence)
      observed[label] = (observed[label] ?? 0) + 1
    }
    const passes = cueRuns.filter((run) => runPasses(cue, run)).length
    return {
      id: cue.id,
      expectation: cue.expectation,
      runs: cueRuns.length,
      passes,
      observed,
      majority: cueRuns.length > 0 && passes * 2 > cueRuns.length,
    }
  })
}

export type ReportMeta = {
  model: string
  configDir: string
  repetitions: number
}

function observedText(observed: Record<string, number>): string {
  return Object.entries(observed)
    .map(([label, count]) => `${label} x${count}`)
    .join(", ")
}

function runDetail(cue: ProbeCue, run: ProbeRun): string {
  const evidence = run.evidence
  const bits: string[] = [outcomeLabel(evidence)]
  const task = evidence.taskCalls[0]
  if (task) bits.push(`[${task.subagent}${task.description ? `: ${task.description}` : ""}]`)
  const question = evidence.questionCalls[0]
  if (question) bits.push(`[question${question.header ? `: ${question.header}` : ""}]`)
  if (run.aborted) bits.push("(aborted)")
  if (run.timedOut) bits.push("(timed out)")
  return `${cue.id.padEnd(18)} ${(bits.join(" ")).padEnd(62)} ${(run.elapsedMs / 1000).toFixed(1)}s  ${run.sessionID}`
}

export function formatReport(meta: ReportMeta, cues: ProbeCue[], runs: ProbeRun[]): string {
  const lines: string[] = []
  lines.push(`Tool-selection probe · model ${meta.model} · repetitions ${meta.repetitions}`)
  lines.push(`config: ${meta.configDir} (mirrored into a throwaway HOME; plugins and lsp stripped)`)
  lines.push("")
  lines.push(`${"cue".padEnd(18)} ${"expect".padEnd(14)} ${"pass".padEnd(7)} observed`)
  for (const row of summarize(cues, runs)) {
    lines.push(
      `${row.id.padEnd(18)} ${row.expectation.padEnd(14)} ${`${row.passes}/${row.runs}`.padEnd(7)} ${observedText(row.observed)}`,
    )
  }
  lines.push("")
  const summary = summarize(cues, runs)
  const allMajority = summary.length > 0 && summary.every((row) => row.majority)
  lines.push(`result: ${allMajority ? "PASS" : "FAIL"} (every cue needs a majority pass)`)
  lines.push("")
  lines.push("runs:")
  for (const cue of cues) {
    for (const run of runs.filter((candidate) => candidate.cue === cue.id)) {
      lines.push(`  ${runDetail(cue, run)}`)
    }
  }
  return lines.join("\n")
}
