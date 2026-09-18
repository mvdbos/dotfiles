import { sha256, type ChangeFingerprint, type FailureCandidate, type ToolObservation, type TodoObservation } from "./packet"

export const DEFAULT_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  "todowrite",
  "question",
  "skill",
  "image_display",
  "image_dismiss",
  "get_goal",
  "get_goal_history",
  "list_all_goals",
  "create_goal",
  "set_goal",
  "clear_goal",
  "update_goal",
  "update_goal_objective",
  "update_goal_status",
])

export type ToolPartLike = {
  type?: unknown
  tool?: unknown
  callID?: unknown
  state?: {
    status?: unknown
    input?: unknown
    output?: unknown
    error?: unknown
    metadata?: unknown
  }
}

export function isSignificantTool(tool: string, exclusions: ReadonlySet<string> = DEFAULT_EXCLUDED_TOOLS): boolean {
  return !exclusions.has(tool.toLowerCase())
}

export function serializeCompact(value: unknown, maxChars = 20_000): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value.slice(0, maxChars)
  try {
    return JSON.stringify(value).slice(0, maxChars)
  } catch {
    return String(value).slice(0, maxChars)
  }
}

export function terminalToolObservation(
  part: ToolPartLike,
  seq: number,
  exclusions: ReadonlySet<string> = DEFAULT_EXCLUDED_TOOLS,
): (ToolObservation & { callID: string }) | undefined {
  if (part.type !== "tool" || typeof part.tool !== "string") return undefined
  const status = part.state?.status
  if (status !== "completed" && status !== "error") return undefined
  if (!isSignificantTool(part.tool, exclusions)) return undefined
  const callID = typeof part.callID === "string" && part.callID ? part.callID : `seq-${seq}`
  const result = status === "error" ? serializeCompact(part.state?.error) : serializeCompact(part.state?.output)
  return {
    seq,
    callID,
    name: part.tool,
    status,
    input: serializeCompact(part.state?.input),
    result,
  }
}

export function failureFromTool(observation: ToolObservation): FailureCandidate | undefined {
  if (observation.status !== "error") return undefined
  const evidence = observation.result || observation.input
  if (!evidence.trim()) return undefined
  return { seq: observation.seq, tool: observation.name, evidence: `${observation.name}: ${evidence}` }
}

const PATH_KEYS = ["filePath", "file_path", "path", "filename", "file"] as const

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function numberFrom(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value))
  }
  return 0
}

export function changeFingerprintFromTool(
  observation: ToolObservation,
  toolPart: ToolPartLike | undefined,
): ChangeFingerprint | undefined {
  const input = recordValue(toolPart?.state?.input) ?? recordValue(observation.input)
  const metadata = recordValue(toolPart?.state?.metadata)
  const filediff = recordValue(metadata?.filediff)
  let path: string | undefined
  for (const key of PATH_KEYS) {
    const value = input?.[key]
    if (typeof value === "string" && value.trim()) {
      path = value
      break
    }
  }
  if (!path) return undefined
  const additions = numberFrom(metadata?.additions, metadata?.added, filediff?.additions, input?.additions)
  const deletions = numberFrom(metadata?.deletions, metadata?.removed, filediff?.deletions, input?.deletions)
  const fingerprint = sha256(
    `${observation.name}\n${path}\n${serializeCompact(input)}\n${observation.result}`,
  )
  return { seq: observation.seq, path, additions, deletions, fingerprint }
}

export function assistantTextFromPart(part: { type?: unknown; text?: unknown; synthetic?: unknown; time?: { end?: unknown } }): string | undefined {
  if (part.type !== "text") return undefined
  if (part.synthetic === true) return undefined
  if (typeof part.text !== "string" || !part.text.trim()) return undefined
  if (part.time?.end === undefined) return undefined
  return part.text
}

export function todoObservations(value: unknown): TodoObservation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const todos: TodoObservation[] = []
  for (const entry of value) {
    const record = recordValue(entry)
    if (
      !record ||
      typeof record.content !== "string" ||
      typeof record.status !== "string" ||
      typeof record.priority !== "string"
    ) {
      return undefined
    }
    todos.push({ content: record.content, status: record.status, priority: record.priority })
  }
  return todos
}

export function eventSessionID(event: { properties?: unknown }): string | undefined {
  const properties = recordValue(event.properties)
  if (!properties) return undefined
  if (typeof properties.sessionID === "string") return properties.sessionID
  const info = recordValue(properties.info)
  if (typeof info?.id === "string") return info.id
  const part = recordValue(properties.part)
  if (typeof part?.sessionID === "string") return part.sessionID
  return undefined
}
