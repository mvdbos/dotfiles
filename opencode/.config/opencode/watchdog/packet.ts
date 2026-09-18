import { createHash } from "node:crypto"
import { CONCERN_CATEGORIES, CRITIC_USER_PROMPT_FOOTER, CRITIC_USER_PROMPT_HEADER, MAX_USER_PROMPT_BYTES, type ConcernCategory } from "./prompt"
import { normalizeConcernText } from "./noise"

export const PACKET_VERSION = 1

export type PacketTrigger = "cadence" | "idle" | "revalidation"

export type ToolObservation = {
  seq: number
  name: string
  status: "completed" | "error"
  input: string
  result: string
}

export type FailureCandidate = {
  seq: number
  tool: string
  evidence: string
}

export type ChangeFingerprint = {
  seq: number
  path: string
  additions: number
  deletions: number
  fingerprint: string
}

export type TodoObservation = {
  content: string
  status: string
  priority: string
}

export type PreviousConcern = {
  category: ConcernCategory
  message: string
  evidenceFingerprint: string
}

export type RevalidationCandidate = {
  severity: "warning" | "critical"
  category: ConcernCategory
  message: string
  sourceEpoch: number
  evidenceFingerprint: string
}

export type PacketPreviousConcern = {
  category: ConcernCategory
  message: string
}

export type PacketRevalidationCandidate = {
  severity: "warning" | "critical"
  category: ConcernCategory
  message: string
}

export type WatchdogPacket = {
  version: typeof PACKET_VERSION
  trigger: PacketTrigger
  task: { original: string; current: string }
  todos?: TodoObservation[]
  recentAssistantText?: string
  tools: Array<ToolObservation & { sincePreviousCheck: boolean }>
  failures?: Array<{ tool: string; evidence: string }>
  changes?: Array<{ path: string; additions: number; deletions: number; changedSincePreviousCheck: boolean }>
  previousConcern?: PacketPreviousConcern
  revalidateConcern?: PacketRevalidationCandidate
}

export type ClaimedEvidence = {
  task: { original: string; current: string }
  todos?: TodoObservation[]
  recentAssistantText?: string
  tools: ToolObservation[]
  failureCandidates?: FailureCandidate[]
  changeFingerprints?: ChangeFingerprint[]
  previousConcern?: PreviousConcern
  omittedBeforeToolSeq?: number
}

export type PacketBaselines = {
  lastCheckToolSeq: number
  previousChangeHashes: ReadonlyMap<string, string>
}

export const PACKET_BUDGETS = {
  originalTask: 1800,
  currentTask: 1800,
  failures: 2000,
  tools: 5000,
  todos: 1000,
  assistant: 1200,
  changes: 1400,
  previousConcern: 600,
  revalidation: 600,
  toolInputHead: 240,
  toolResultHead: 220,
  toolResultTail: 360,
  maxChangePaths: 40,
} as const

export const MINIMAL_PACKET_BUDGETS = {
  originalTask: 400,
  currentTask: 600,
  failures: 400,
  tools: 1200,
  todos: 200,
  assistant: 200,
  changes: 200,
  previousConcern: 200,
  revalidation: 300,
  toolInputHead: 120,
  toolResultHead: 100,
  toolResultTail: 160,
  maxChangePaths: 8,
} as const

type Budgets = typeof PACKET_BUDGETS | typeof MINIMAL_PACKET_BUDGETS

export function sanitizeText(text: string): string {
  let output = ""
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code === 0) {
      output += "\\0"
    } else if (code < 0x20 && character !== "\n" && character !== "\t") {
      output += `\\u${code.toString(16).padStart(4, "0")}`
    } else {
      output += character
    }
  }
  return output
}

export function headText(text: string, maxChars: number): string {
  const characters = Array.from(text)
  if (characters.length <= maxChars) return text
  return `${characters.slice(0, Math.max(0, maxChars - 1)).join("")}…`
}

export function tailText(text: string, maxChars: number): string {
  const characters = Array.from(text)
  if (characters.length <= maxChars) return text
  return `…${characters.slice(characters.length - Math.max(0, maxChars - 1)).join("")}`
}

export function headTailText(text: string, maxChars: number): string {
  const characters = Array.from(text)
  if (characters.length <= maxChars) return text
  const headLength = Math.ceil(maxChars / 2)
  const tailLength = maxChars - headLength
  return `${characters.slice(0, Math.max(0, headLength - 1)).join("")}…${characters
    .slice(characters.length - Math.max(0, tailLength - 1))
    .join("")}`
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function boundedTool(tool: ToolObservation, budgets: Budgets): ToolObservation {
  const input = sanitizeText(tool.input)
  const result = sanitizeText(tool.result)
  const resultLimit = budgets.toolResultHead + budgets.toolResultTail
  return {
    seq: tool.seq,
    name: headText(tool.name, 80),
    status: tool.status,
    input: headText(input, budgets.toolInputHead),
    result: result.length <= resultLimit ? result : `${headText(result, budgets.toolResultHead)}${tailText(result, budgets.toolResultTail)}`,
  }
}

function boundedFailure(failure: FailureCandidate, budgets: Budgets): FailureCandidate {
  return {
    seq: failure.seq,
    tool: headText(failure.tool, 80),
    evidence: headTailText(sanitizeText(failure.evidence), budgets.failures),
  }
}

export function boundEvidence(
  evidence: ClaimedEvidence,
  options: { maxRecentTools: number; budgets?: Budgets },
): ClaimedEvidence {
  const budgets = options.budgets ?? PACKET_BUDGETS
  const tools = [...evidence.tools].sort((left, right) => right.seq - left.seq).slice(0, options.maxRecentTools)
  const boundedTools: ToolObservation[] = []
  let usedChars = 0
  let droppedSeq: number | undefined
  for (const tool of tools) {
    const bounded = boundedTool(tool, budgets)
    const size = bounded.input.length + bounded.result.length
    if (usedChars + size > budgets.tools) {
      const remaining = budgets.tools - usedChars
      if (remaining >= 80) {
        const ratio = remaining / Math.max(1, size)
        boundedTools.push({
          ...bounded,
          input: headText(bounded.input, Math.max(20, Math.floor(bounded.input.length * ratio))),
          result: headText(bounded.result, Math.max(20, Math.floor(bounded.result.length * ratio))),
        })
        usedChars += Math.floor(bounded.input.length * ratio) + Math.floor(bounded.result.length * ratio)
        droppedSeq ??= tool.seq
      } else {
        droppedSeq ??= tool.seq
      }
      continue
    }
    boundedTools.push(bounded)
    usedChars += size
  }

  const failureCandidates = (evidence.failureCandidates ?? [])
    .map((failure) => boundedFailure(failure, budgets))
    .slice(0, 12)

  const changeFingerprints = (evidence.changeFingerprints ?? []).slice(-budgets.maxChangePaths)

  return {
    task: {
      original: headTailText(sanitizeText(evidence.task.original), budgets.originalTask),
      current: headTailText(sanitizeText(evidence.task.current), budgets.currentTask),
    },
    ...(evidence.todos ? { todos: evidence.todos.slice(0, 40).map((todo) => ({ content: headText(sanitizeText(todo.content), 200), status: todo.status, priority: todo.priority })) } : {}),
    ...(evidence.recentAssistantText
      ? { recentAssistantText: tailText(sanitizeText(evidence.recentAssistantText), budgets.assistant) }
      : {}),
    tools: boundedTools,
    ...(failureCandidates.length > 0 ? { failureCandidates } : {}),
    ...(changeFingerprints.length > 0 ? { changeFingerprints } : {}),
    ...(evidence.previousConcern
      ? {
          previousConcern: {
            category: evidence.previousConcern.category,
            message: headTailText(evidence.previousConcern.message, budgets.previousConcern),
            evidenceFingerprint: evidence.previousConcern.evidenceFingerprint,
          },
        }
      : {}),
    ...(droppedSeq !== undefined
      ? { omittedBeforeToolSeq: Math.min(droppedSeq, evidence.omittedBeforeToolSeq ?? droppedSeq) }
      : evidence.omittedBeforeToolSeq !== undefined
        ? { omittedBeforeToolSeq: evidence.omittedBeforeToolSeq }
        : {}),
  }
}

export function materializePacket(
  evidence: ClaimedEvidence,
  trigger: PacketTrigger,
  baselines: PacketBaselines,
  candidate?: RevalidationCandidate,
): WatchdogPacket {
  const tools = [...evidence.tools].sort((left, right) => right.seq - left.seq)
  const failures: Array<{ tool: string; evidence: string }> = []
  const failureEvidence = evidence.failureCandidates ?? []
  const fresh = failureEvidence.filter((failure) => failure.seq > baselines.lastCheckToolSeq).sort((a, b) => b.seq - a.seq)
  const older = failureEvidence.filter((failure) => failure.seq <= baselines.lastCheckToolSeq).sort((a, b) => b.seq - a.seq)
  for (const failure of [...fresh, ...older]) failures.push({ tool: failure.tool, evidence: failure.evidence })

  const changes = (evidence.changeFingerprints ?? [])
    .slice()
    .sort((left, right) => left.seq - right.seq)
    .map((change) => ({
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
      changedSincePreviousCheck: baselines.previousChangeHashes.get(change.path) !== change.fingerprint,
    }))

  return {
    version: PACKET_VERSION,
    trigger,
    task: evidence.task,
    ...(evidence.todos ? { todos: evidence.todos } : {}),
    ...(evidence.recentAssistantText ? { recentAssistantText: evidence.recentAssistantText } : {}),
    tools: tools.map((tool) => ({
      seq: tool.seq,
      name: tool.name,
      status: tool.status,
      sincePreviousCheck: tool.seq > baselines.lastCheckToolSeq,
      input: tool.input,
      result: tool.result,
    })),
    ...(failures.length > 0 ? { failures } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    ...(evidence.previousConcern
      ? {
          previousConcern: {
            category: evidence.previousConcern.category,
            message: evidence.previousConcern.message,
          },
        }
      : {}),
    ...(candidate
      ? {
          revalidateConcern: {
            severity: candidate.severity,
            category: candidate.category,
            message: candidate.message,
          },
        }
      : {}),
  }
}

export function canonicalPacketJson(packet: WatchdogPacket): string {
  return JSON.stringify(packet)
}

export function buildCriticPrompt(packet: WatchdogPacket): string {
  return `${CRITIC_USER_PROMPT_HEADER}${canonicalPacketJson(packet)}${CRITIC_USER_PROMPT_FOOTER}`
}

function requiredTask(packet: WatchdogPacket): boolean {
  return packet.task.original.length > 0 || packet.task.current.length > 0
}

export type FitResult = { prompt: string; packet: WatchdogPacket; omissions: string[] } | { error: string }

export function fitUserPrompt(packet: WatchdogPacket, options: { maxBytes?: number } = {}): FitResult {
  const maxBytes = options.maxBytes ?? MAX_USER_PROMPT_BYTES
  let current: WatchdogPacket = JSON.parse(JSON.stringify(packet)) as WatchdogPacket
  const omissions: string[] = []

  const measured = () => Buffer.byteLength(buildCriticPrompt(current), "utf8")

  if (measured() > maxBytes) {
    const reductionOrder: Array<{ name: string; apply: () => boolean }> = [
      {
        name: "tools",
        apply: () => {
          const index = current.tools.findLastIndex((tool) => tool.status === "completed")
          const target = index >= 0 ? index : current.tools.length - 1
          if (target < 0) return false
          current.tools.splice(target, 1)
          return true
        },
      },
      {
        name: "failures",
        apply: () => {
          if (!current.failures?.length) return false
          current.failures.pop()
          if (current.failures.length === 0) delete current.failures
          return true
        },
      },
      {
        name: "changes",
        apply: () => {
          if (!current.changes?.length) return false
          current.changes = []
          delete current.changes
          return true
        },
      },
      {
        name: "todos",
        apply: () => {
          if (!current.todos) return false
          delete current.todos
          return true
        },
      },
      {
        name: "assistant",
        apply: () => {
          if (!current.recentAssistantText) return false
          delete current.recentAssistantText
          return true
        },
      },
      {
        name: "previousConcern",
        apply: () => {
          if (!current.previousConcern) return false
          delete current.previousConcern
          return true
        },
      },
    ]

    for (const reduction of reductionOrder) {
      while (measured() > maxBytes && reduction.apply()) {
        omissions.push(reduction.name)
      }
      if (measured() <= maxBytes) break
    }
  }

  if (measured() > maxBytes) {
    return { error: "watchdog prompt cannot be bounded within the UTF-8 byte cap" }
  }
  if (!requiredTask(current)) {
    return { error: "watchdog packet has no bounded task text" }
  }
  return { prompt: buildCriticPrompt(current), packet: current, omissions }
}

export function evidenceFingerprint(packet: WatchdogPacket): string {
  const parts: string[] = [
    `v${packet.version}`,
    `trigger:${packet.trigger}`,
    `task:${normalizeConcernText(packet.task.current)}`,
  ]
  if (packet.todos) {
    parts.push(`todos:${packet.todos.map((todo) => `${todo.content}|${todo.status}|${todo.priority}`).join(";")}`)
  }
  parts.push(
    `tools:${packet.tools
      .slice()
      .sort((left, right) => left.seq - right.seq)
      .map((tool) => `${tool.seq}:${tool.name}:${tool.status}:${sha256(tool.input)}:${sha256(tool.result)}`)
      .join(";")}`,
  )
  if (packet.failures) {
    parts.push(`failures:${packet.failures.map((failure) => `${failure.tool}:${sha256(failure.evidence)}`).join(";")}`)
  }
  if (packet.changes) {
    parts.push(
      `changes:${packet.changes
        .map((change) => `${change.path}:${change.additions}:${change.deletions}:${change.changedSincePreviousCheck}`)
        .join(";")}`,
    )
  }
  if (packet.recentAssistantText) parts.push(`assistant:${sha256(packet.recentAssistantText)}`)
  if (packet.previousConcern) {
    parts.push(
      `previous:${packet.previousConcern.category}:${sha256(normalizeConcernText(packet.previousConcern.message))}`,
    )
  }
  return sha256(parts.join("\n"))
}

export function snapshotKey(...identifiers: Array<string | number | undefined>): string {
  return sha256(identifiers.filter((value) => value !== undefined).join("|"))
}

export function isKnownConcernCategory(value: unknown): value is ConcernCategory {
  return typeof value === "string" && (CONCERN_CATEGORIES as readonly string[]).includes(value)
}
