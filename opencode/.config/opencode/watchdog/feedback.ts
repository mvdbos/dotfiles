import { WATCHDOG_ADVISORY_HEADER } from "../plugin-generated-user/helpers"
import { isSignificantTool } from "./collect"
import { buildIdleAdvisory, buildRunAdvisory, watchdogMetadata } from "./prompt"

export class CompactionSkipGuard {
  private readonly skips = new Map<string, number>()

  arm(sessionID: string): void {
    this.skips.set(sessionID, (this.skips.get(sessionID) ?? 0) + 1)
  }

  consume(sessionID: string): boolean {
    const count = this.skips.get(sessionID)
    if (!count) return false
    if (count <= 1) this.skips.delete(sessionID)
    else this.skips.set(sessionID, count - 1)
    return true
  }

  clear(sessionID: string): void {
    this.skips.delete(sessionID)
  }

  clearAll(): void {
    this.skips.clear()
  }
}

export type RequestPart = {
  id?: unknown
  type?: unknown
  tool?: unknown
  text?: unknown
  synthetic?: unknown
  metadata?: unknown
  state?: {
    status?: unknown
    output?: unknown
    time?: { end?: unknown }
  }
}

export type RequestMessage = {
  info?: { sessionID?: unknown }
  parts?: RequestPart[]
}

export type AdvisoryInstallState = {
  installedPartID?: string
  installedText?: string
  seenParts: Set<string>
}

export function sessionIDFromMessages(messages: readonly RequestMessage[]): string | undefined {
  for (const message of messages) {
    if (typeof message.info?.sessionID === "string") return message.info.sessionID
  }
  return undefined
}

function toolParts(messages: readonly RequestMessage[]): Array<{ id: string; part: RequestPart }> {
  const parts: Array<{ id: string; part: RequestPart }> = []
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") continue
      if (typeof part.tool === "string" && !isSignificantTool(part.tool)) continue
      if (part.state?.status !== "completed") continue
      if (typeof part.state.output !== "string") continue
      if (typeof part.id !== "string") continue
      parts.push({ id: part.id, part })
    }
  }
  return parts
}

export function installRunAdvisory(
  messages: readonly RequestMessage[],
  advisory: string,
  state: AdvisoryInstallState,
): { partID: string; text: string } | undefined {
  const parts = toolParts(messages)

  if (state.installedPartID) {
    const installed = parts.find((candidate) => candidate.id === state.installedPartID)
    if (installed) {
      const output = String(installed.part.state?.output ?? "")
      if (state.installedText && !output.includes(state.installedText)) {
        installed.part.state!.output = `${output}${state.installedText}`
      }
      for (const candidate of parts) state.seenParts.add(candidate.id)
      return { partID: state.installedPartID, text: state.installedText ?? advisory }
    }
    state.installedPartID = undefined
    state.installedText = undefined
  }

  const fresh = parts.filter((candidate) => !state.seenParts.has(candidate.id))
  for (const candidate of parts) state.seenParts.add(candidate.id)
  if (fresh.length === 0) return undefined

  const newest = fresh[fresh.length - 1]!
  newest.part.state!.output = `${String(newest.part.state?.output ?? "")}${advisory}`
  state.installedPartID = newest.id
  state.installedText = advisory
  return { partID: newest.id, text: advisory }
}

export function runAdvisoryFor(message: string): string {
  return buildRunAdvisory(message)
}

export type IdlePromptBody = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  parts: Array<{ type: "text"; text: string; metadata: Record<string, unknown> }>
}

export function buildIdlePromptBody(input: {
  message: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  findingHash: string
  turnEpoch: number
}): IdlePromptBody {
  return {
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    parts: [
      {
        type: "text",
        text: buildIdleAdvisory(input.message),
        metadata: watchdogMetadata({ findingHash: input.findingHash, turnEpoch: input.turnEpoch }),
      },
    ],
  }
}

export type ConcernToastState = {
  status: "pending" | "delivered" | "failed"
  attempts: 1 | 2
}

export function shouldAttemptToast(state: ConcernToastState | undefined): boolean {
  if (!state) return true
  if (state.status === "pending" || state.status === "delivered") return false
  return state.attempts < 2
}

export function toastStateAfterAttempt(state: ConcernToastState | undefined, succeeded: boolean): ConcernToastState {
  const attempts = state?.attempts ?? 0
  const nextAttempts = (attempts + 1) as 1 | 2
  return { status: succeeded ? "delivered" : "failed", attempts: nextAttempts }
}

export function isWatchdogAdvisoryText(text: string): boolean {
  return text.startsWith(WATCHDOG_ADVISORY_HEADER)
}
