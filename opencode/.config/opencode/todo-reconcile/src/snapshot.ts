import { createHash } from "node:crypto"
import type { Part } from "@opencode-ai/sdk"
import { type TodoProjection, type ReminderTodo } from "./reminder"

export const SNAPSHOT_MARKER = "todo-reconcile"
export const SNAPSHOT_SCHEMA_VERSION = 1

export type SnapshotMetadata = {
  [SNAPSHOT_MARKER]: true
  schemaVersion: number
  boundaryID: string
  fingerprint: string
  complete: boolean
  includedPositions: number[]
  omittedActive: number
  omittedClosed: number
  truncatedPositions: number[]
  originatingContinuationID?: string
}

export type SnapshotRecord = {
  part: Extract<Part, { type: "text" }>
  metadata: SnapshotMetadata
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** Fingerprint the full ordered persisted list, never only its projection. */
export function canonicalTodoFingerprint(todos: readonly ReminderTodo[]): string {
  return digest(JSON.stringify(todos.map((todo) => [todo.content, todo.status, todo.priority])))
}

export function snapshotPartID(input: {
  sessionID: string
  messageID: string
  boundaryID: string
  fingerprint: string
}): string {
  return `prt_todo_reconcile_${digest(
    [input.sessionID, input.messageID, input.boundaryID, input.fingerprint].join("\0"),
  ).slice(0, 32)}`
}

export function snapshotMetadata(input: {
  boundaryID: string
  fingerprint: string
  projection: TodoProjection
  originatingContinuationID?: string
}): SnapshotMetadata {
  return {
    [SNAPSHOT_MARKER]: true,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    boundaryID: input.boundaryID,
    fingerprint: input.fingerprint,
    complete: input.projection.complete,
    includedPositions: [...input.projection.includedPositions],
    omittedActive: input.projection.omittedActive,
    omittedClosed: input.projection.omittedClosed,
    truncatedPositions: [...input.projection.truncatedPositions],
    ...(input.originatingContinuationID ? { originatingContinuationID: input.originatingContinuationID } : {}),
  }
}

export function makeSnapshotPart(input: {
  sessionID: string
  messageID: string
  partID: string
  text: string
  metadata: SnapshotMetadata
}): Extract<Part, { type: "text" }> {
  return {
    id: input.partID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: input.text,
    synthetic: true,
    metadata: input.metadata,
  }
}

function integerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

export function parseSnapshotMetadata(part: Part): SnapshotMetadata | undefined {
  if (part.type !== "text" || part.metadata?.[SNAPSHOT_MARKER] !== true) return undefined
  const metadata = part.metadata
  if (
    metadata.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    typeof metadata.boundaryID !== "string" ||
    typeof metadata.fingerprint !== "string" ||
    typeof metadata.complete !== "boolean" ||
    !integerArray(metadata.includedPositions) ||
    !nonNegativeInteger(metadata.omittedActive) ||
    !nonNegativeInteger(metadata.omittedClosed) ||
    !integerArray(metadata.truncatedPositions) ||
    (metadata.originatingContinuationID !== undefined && typeof metadata.originatingContinuationID !== "string")
  ) {
    return undefined
  }
  return {
    [SNAPSHOT_MARKER]: true,
    schemaVersion: metadata.schemaVersion,
    boundaryID: metadata.boundaryID,
    fingerprint: metadata.fingerprint,
    complete: metadata.complete,
    includedPositions: [...metadata.includedPositions],
    omittedActive: metadata.omittedActive,
    omittedClosed: metadata.omittedClosed,
    truncatedPositions: [...metadata.truncatedPositions],
    ...(metadata.originatingContinuationID
      ? { originatingContinuationID: metadata.originatingContinuationID }
      : {}),
  }
}

export function isPluginSnapshotPart(part: Part): boolean {
  return part.type === "text" && part.metadata?.[SNAPSHOT_MARKER] === true
}

export function snapshotRecord(part: Part): SnapshotRecord | undefined {
  const metadata = parseSnapshotMetadata(part)
  if (!metadata || part.type !== "text") return undefined
  return { part, metadata }
}
