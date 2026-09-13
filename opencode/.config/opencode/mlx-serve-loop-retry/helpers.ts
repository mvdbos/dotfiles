export type PromptPart =
  | { id?: string; type: "text"; text: string }
  | { id?: string; type: "file"; mime: string; filename?: string; url: string; source?: unknown }
  | { id?: string; type: "agent"; name: string; source?: unknown }
  | { id?: string; type: "subtask"; prompt: string; description: string; agent: string }

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null ? (value as RecordValue) : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = record(value)?.[key]
  return typeof candidate === "string" ? candidate : undefined
}

export function toPromptParts(parts: unknown): PromptPart[] {
  if (!Array.isArray(parts)) return []
  const mapped: PromptPart[] = []
  for (const part of parts) {
    const data = record(part)
    if (!data || data.synthetic === true) continue
    const id = stringField(data, "id")
    if (data.type === "text" && typeof data.text === "string") {
      mapped.push({ ...(id ? { id } : {}), type: "text", text: data.text })
      continue
    }
    if (data.type === "file" && typeof data.mime === "string" && typeof data.url === "string") {
      mapped.push({
        ...(id ? { id } : {}),
        type: "file",
        mime: data.mime,
        ...(typeof data.filename === "string" ? { filename: data.filename } : {}),
        url: data.url,
        ...(data.source !== undefined ? { source: data.source } : {}),
      })
      continue
    }
    if (data.type === "agent" && typeof data.name === "string") {
      mapped.push({
        ...(id ? { id } : {}),
        type: "agent",
        name: data.name,
        ...(data.source !== undefined ? { source: data.source } : {}),
      })
      continue
    }
    if (
      data.type === "subtask" &&
      typeof data.prompt === "string" &&
      typeof data.description === "string" &&
      typeof data.agent === "string"
    ) {
      mapped.push({
        ...(id ? { id } : {}),
        type: "subtask",
        prompt: data.prompt,
        description: data.description,
        agent: data.agent,
      })
    }
  }
  return mapped
}

export type SseScan = { hit: boolean; rest: string }

export function parseSseLoopChunk(buffer: string): SseScan {
  const lines = buffer.split("\n")
  const rest = lines.pop() ?? ""
  return { hit: lines.some(isLoopLine), rest }
}

function isLoopLine(line: string): boolean {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line
  if (!trimmed.startsWith("data:")) return false
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === "[DONE]") return false
  try {
    const choices = record(JSON.parse(payload))?.choices
    if (!Array.isArray(choices)) return false
    return choices.some((choice) => record(record(choice)?.finish_details)?.type === "repetition_loop")
  } catch {
    return false
  }
}

export type IdleDecision =
  | { kind: "none" }
  | { kind: "skip-child" }
  | { kind: "give-up" }
  | { kind: "retry"; attempt: number }

export function decideIdle(input: {
  pending: Iterable<string>
  attempts: ReadonlyMap<string, number>
  retries: number
  parentID?: string
}): IdleDecision {
  const keys = [...input.pending]
  if (keys.length === 0) return { kind: "none" }
  if (input.parentID) return { kind: "skip-child" }
  const key = keys[keys.length - 1]!
  const attempt = input.attempts.get(key) ?? 0
  if (attempt >= input.retries) return { kind: "give-up" }
  return { kind: "retry", attempt: attempt + 1 }
}

export type Toast = { title: string; message: string; variant: "warning" | "error" }

export function toastFor(kind: "attempt" | "exhausted", attempt: number, retries: number): Toast {
  if (kind === "attempt") {
    return {
      title: "mlx-serve",
      message: `Repeated output loop — retrying ${attempt}/${retries}`,
      variant: "warning",
    }
  }
  return {
    title: "mlx-serve",
    message: `Repeated output loop — gave up after ${retries} retries`,
    variant: "error",
  }
}
