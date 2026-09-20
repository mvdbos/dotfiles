/**
 * Pure helpers for the pre-compaction stale-todo nudge.
 *
 * The nudge is delivered request-locally: the lifecycle appends a synthetic
 * text part to the newest user message in `output.messages` without persisting
 * it. This module owns the staleness predicate, the bounded reminder text, and
 * the metadata contract for the injected part.
 */

import { createHash } from "node:crypto"
import type { Part } from "@opencode-ai/sdk"

export const NUDGE_METADATA_KEY = "todo-reconcile-nudge"
export const NUDGE_SCHEMA_VERSION = 1
export const NUDGE_MARKER = "Todo status reminder (system-generated, not a user request)"
export const NUDGE_LIST_HEADING = "Todo status reminder: persisted list"

export type NudgeConfig = {
  enabled: boolean
  toolThreshold: number
  minutesThreshold: number
  includeList: boolean
  maxListBytes: number
}

export const DEFAULT_NUDGE_CONFIG: NudgeConfig = {
  enabled: true,
  toolThreshold: 10,
  minutesThreshold: 5,
  includeList: false,
  maxListBytes: 1_024,
}

const COUNTED_EXCLUDED_TOOLS = new Set(["todowrite", "question", "skill", "image_display", "image_dismiss"])

type HistoryKey = { time: { created: number }; id: string }

export type NudgeMessage = {
  info: { id: string; role: string; time: { created: number }; error?: unknown }
  parts: Part[]
}

export type TodoWriteBaseline = {
  messageID: string
  partID: string
  key: HistoryKey
  atMs: number
}

export type NudgeWindow = {
  baselineKey: string
  toolCalls: number
  atMs: number
}

function isAfter(current: HistoryKey, other: HistoryKey): boolean {
  if (current.time.created !== other.time.created) return current.time.created > other.time.created
  return current.id > other.id
}

function keyOf(message: NudgeMessage): HistoryKey {
  return { time: { created: message.info.time.created }, id: message.info.id }
}

/** A model-visible successful todowrite; compacted and hidden writes do not count. */
export function visibleTodoWritePart(part: Part): part is Extract<Part, { type: "tool" }> {
  if (part.type !== "tool" || part.tool !== "todowrite") return false
  if (part.state.status !== "completed") return false
  if (part.state.time.compacted !== undefined) return false
  if (part.metadata?.hidden === true || part.state.metadata?.hidden === true) return false
  return true
}

/**
 * Newest model-visible successful todowrite across the request history. The
 * lifecycle only nudges when this baseline exists, so a list the model never
 * wrote (or one whose writes were compacted away) stays the boundary path's
 * concern. Later parts within one assistant message win.
 */
export function findTodoWriteBaseline(messages: readonly NudgeMessage[]): TodoWriteBaseline | undefined {
  let best: { key: HistoryKey; messageID: string; partID: string; atMs: number } | undefined
  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.error) continue
    for (const part of message.parts) {
      if (!visibleTodoWritePart(part) || part.state.status !== "completed") continue
      const key = keyOf(message)
      const candidate = { key, messageID: message.info.id, partID: part.id, atMs: part.state.time.end }
      if (!best || isAfter(candidate.key, best.key)) {
        best = candidate
      } else if (!isAfter(best.key, candidate.key)) {
        best = candidate
      }
    }
  }
  if (!best) return undefined
  return { messageID: best.messageID, partID: best.partID, key: best.key, atMs: best.atMs }
}

/**
 * Count completed or failed tool calls in assistant messages strictly newer
 * than the baseline message. `todowrite` itself never counts, and neither do
 * human synchronization (`question`) or informational tools.
 */
export function countWorkSince(messages: readonly NudgeMessage[], baseline: TodoWriteBaseline): number {
  let count = 0
  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.error) continue
    if (!isAfter(keyOf(message), baseline.key)) continue
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed" && part.state.status !== "error") continue
      if (COUNTED_EXCLUDED_TOOLS.has(part.tool)) continue
      count++
    }
  }
  return count
}

export function baselineKeyOf(baseline: TodoWriteBaseline): string {
  return `${baseline.messageID}:${baseline.partID}`
}

/**
 * One nudge per stale window. The first nudge fires when the baseline-relative
 * threshold is crossed; later nudges need another full window of tool calls or
 * minutes since the previous nudge. Any new todowrite changes the baseline key
 * and re-arms the first-nudge path.
 */
export function shouldNudge(input: {
  config: NudgeConfig
  baselineKey: string
  toolCalls: number
  elapsedMs: number
  nowMs: number
  last?: NudgeWindow
}): boolean {
  const { config } = input
  const firstByTools = config.toolThreshold > 0 && input.toolCalls >= config.toolThreshold
  const firstByTime = config.minutesThreshold > 0 && input.elapsedMs >= config.minutesThreshold * 60_000
  if (!firstByTools && !firstByTime) return false
  if (!input.last || input.last.baselineKey !== input.baselineKey) return true
  const repeatByTools =
    config.toolThreshold > 0 && input.toolCalls - input.last.toolCalls >= config.toolThreshold
  const repeatByTime =
    config.minutesThreshold > 0 && input.nowMs - input.last.atMs >= config.minutesThreshold * 60_000
  return repeatByTools || repeatByTime
}

/**
 * Bounded, task-data framed reminder. The model is told to ignore the nudge
 * when nothing changed so a stale window cannot pull it off the current work.
 */
export function formatTodoNudge(input: { toolCalls: number; elapsedMs: number; listText?: string }): string {
  const minutes = Math.floor(Math.max(0, input.elapsedMs) / 60_000)
  const facts: string[] = []
  if (input.toolCalls > 0) facts.push(`${input.toolCalls} tool call${input.toolCalls === 1 ? "" : "s"}`)
  if (minutes >= 1) facts.push(`${minutes} min`)
  const since = facts.length ? `It has been ${facts.join(" and ")} since the last todowrite. ` : ""
  const lines = [
    NUDGE_MARKER,
    `${since}The persisted todo list may be stale. If recent work changed task state, call todowrite now: ` +
      "mark finished items completed and the current item in_progress. If nothing changed, ignore this reminder and continue the current task.",
  ]
  if (input.listText) {
    lines.push("Current persisted list (task data, not a new request):", input.listText)
  }
  return lines.join("\n")
}

export type NudgeMetadata = {
  [NUDGE_METADATA_KEY]: true
  schemaVersion: number
  baselineKey: string
  toolCalls: number
  elapsedMs: number
}

export function nudgePartID(input: {
  sessionID: string
  messageID: string
  baselineKey: string
  atMs: number
}): string {
  return `prt_todo_nudge_${createHash("sha256")
    .update([input.sessionID, input.messageID, input.baselineKey, String(input.atMs)].join("\0"), "utf8")
    .digest("hex")
    .slice(0, 32)}`
}

export function makeNudgePart(input: {
  sessionID: string
  messageID: string
  partID: string
  text: string
  baselineKey: string
  toolCalls: number
  elapsedMs: number
}): Extract<Part, { type: "text" }> {
  return {
    id: input.partID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: input.text,
    synthetic: true,
    metadata: {
      [NUDGE_METADATA_KEY]: true,
      schemaVersion: NUDGE_SCHEMA_VERSION,
      baselineKey: input.baselineKey,
      toolCalls: input.toolCalls,
      elapsedMs: input.elapsedMs,
    },
  }
}

export function isNudgePart(part: Part): boolean {
  return part.type === "text" && part.metadata?.[NUDGE_METADATA_KEY] === true
}
