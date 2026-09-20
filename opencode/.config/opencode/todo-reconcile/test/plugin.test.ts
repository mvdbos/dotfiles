import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk"
import type { MessageWithParts, TodoItem } from "../src/lifecycle"
import { mirrorTextParts } from "../src/plugin"
import { formatTodoReminder } from "../src/reminder"
import {
  canonicalTodoFingerprint,
  makeSnapshotPart,
  snapshotMetadata,
  snapshotPartID,
} from "../src/snapshot"

const todos: TodoItem[] = [{ content: "task", status: "pending", priority: "high" }]

function message(parts: Part[]): MessageWithParts {
  return {
    info: { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } },
    parts,
  } as unknown as MessageWithParts
}

function snapshotPart(): Part {
  const projection = formatTodoReminder(todos)!
  const fingerprint = canonicalTodoFingerprint(todos)
  return makeSnapshotPart({
    sessionID: "s1",
    messageID: "u1",
    partID: snapshotPartID({ sessionID: "s1", messageID: "u1", boundaryID: "a1", fingerprint }),
    text: projection.text,
    metadata: snapshotMetadata({ boundaryID: "a1", fingerprint, projection }),
  })
}

describe("mirrorTextParts", () => {
  test("copies non-snapshot text parts verbatim, preserving order, flags, and metadata", () => {
    const first = {
      id: "prt_a",
      sessionID: "s1",
      messageID: "u1",
      type: "text",
      text: "one",
      ignored: true,
      metadata: { keep: 1 },
    } as unknown as Extract<Part, { type: "text" }>
    const second = {
      id: "prt_b",
      sessionID: "s1",
      messageID: "u1",
      type: "text",
      text: "two",
    } as unknown as Extract<Part, { type: "text" }>
    const tool = {
      id: "prt_c",
      sessionID: "s1",
      messageID: "u1",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: {},
    } as unknown as Part

    const mirrored = mirrorTextParts(message([first, second, tool, snapshotPart()]))
    expect(mirrored).toEqual([first, second])
    expect(mirrored[0]).not.toBe(first)
  })

  test("returns nothing when the turn carries no text parts", () => {
    const tool = {
      id: "prt_t",
      sessionID: "s1",
      messageID: "u1",
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: {},
    } as unknown as Part
    expect(mirrorTextParts(message([tool]))).toEqual([])
  })
})
