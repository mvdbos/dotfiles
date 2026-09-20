/**
 * Pure helpers for the pre-compaction stale-todo nudge.
 *
 * The nudge is appended to the next eligible successful tool output before
 * that output is persisted. This module owns the staleness predicate and the
 * stable bounded reminder text.
 */

import type { Part } from "@opencode-ai/sdk"

export const NUDGE_MARKER = "Todo status reminder (system-generated, not a user request)"

export type NudgeConfig = {
  enabled: boolean
  toolThreshold: number
  minutesThreshold: number
}

export const DEFAULT_NUDGE_CONFIG: NudgeConfig = {
  enabled: true,
  toolThreshold: 10,
  minutesThreshold: 5,
}

const COUNTED_EXCLUDED_TOOLS = new Set(["todowrite", "question", "skill", "image_display", "image_dismiss"])

export function isEligibleNudgeTool(tool: string): boolean {
  return !COUNTED_EXCLUDED_TOOLS.has(tool) && !/^mcp(?:[_.:-]|$)/i.test(tool)
}

type HistoryKey = { time: { created: number }; id: string }

export type NudgeMessage = {
  info: { id: string; role: string; time: { created: number }; error?: unknown }
  parts: Part[]
}

export type TodoWriteBaseline = {
  messageID: string
  partID: string
  partIndex: number
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
  let best: TodoWriteBaseline | undefined
  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.error) continue
    for (const [partIndex, part] of message.parts.entries()) {
      if (!visibleTodoWritePart(part) || part.state.status !== "completed") continue
      const key = keyOf(message)
      const candidate = { key, messageID: message.info.id, partID: part.id, partIndex, atMs: part.state.time.end }
      if (!best || isAfter(candidate.key, best.key) || (!isAfter(best.key, candidate.key) && partIndex > best.partIndex)) best = candidate
    }
  }
  return best
}

/**
 * Count successful eligible tools after the baseline part, including later
 * parts in the same assistant message. Human, informational, and unverified
 * MCP tools do not count.
 */
export function countWorkSince(messages: readonly NudgeMessage[], baseline: TodoWriteBaseline): number {
  let count = 0
  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.error) continue
    const messageKey = keyOf(message)
    const sameMessage = !isAfter(messageKey, baseline.key) && !isAfter(baseline.key, messageKey)
    if (!sameMessage && !isAfter(messageKey, baseline.key)) continue
    for (const [partIndex, part] of message.parts.entries()) {
      if (sameMessage && partIndex <= baseline.partIndex) continue
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (!isEligibleNudgeTool(part.tool)) continue
      count++
    }
  }
  return count
}

export function baselineKeyOf(baseline: TodoWriteBaseline): string {
  return `${baseline.messageID}:${baseline.partID}`
}

/**
 * One nudge per todowrite baseline. A later successful todowrite changes the
 * baseline key and re-arms delivery.
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
  return !input.last || input.last.baselineKey !== input.baselineKey
}

/**
 * Bounded, task-data framed reminder. The model is told to ignore the nudge
 * when nothing changed so a stale window cannot pull it off the current work.
 */
export function formatTodoNudge(input: { toolCalls: number; elapsedMs: number; listText?: string }): string {
  void input
  return [
    NUDGE_MARKER,
    "The persisted todo list may be stale. If recent work changed task state, call todowrite now: " +
      "mark finished items completed and the current item in_progress. If nothing changed, ignore this reminder and continue the current task.",
  ].join("\n")
}
