/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import {
  assistantTextFromPart,
  changeFingerprintFromTool,
  failureFromTool,
  isSignificantTool,
  terminalToolObservation,
  todoObservations,
} from "./collect"

function toolPart(overrides: Record<string, unknown> = {}) {
  return {
    type: "tool",
    tool: "bash",
    callID: "call-1",
    state: { status: "completed", input: { command: "echo hi" }, output: "hi\n", metadata: {} },
    ...overrides,
  }
}

describe("significant tool classification", () => {
  test("includes work tools and excludes state/control tools", () => {
    for (const tool of ["bash", "read", "glob", "grep", "edit", "write", "apply_patch", "task", "webfetch", "custom-tool"]) {
      expect(isSignificantTool(tool)).toBe(true)
    }
    for (const tool of ["todowrite", "question", "skill", "image_display", "image_dismiss", "ToDoWrite"]) {
      expect(isSignificantTool(tool)).toBe(false)
    }
  })

  test("records terminal completed and error calls only", () => {
    const completed = terminalToolObservation(toolPart(), 3)
    expect(completed).toMatchObject({ seq: 3, name: "bash", status: "completed", input: '{"command":"echo hi"}', result: "hi\n" })
    const failed = terminalToolObservation(
      toolPart({ state: { status: "error", input: { command: "false" }, error: "exit 1" } }),
      4,
    )
    expect(failed).toMatchObject({ seq: 4, status: "error", result: "exit 1" })
    expect(terminalToolObservation(toolPart({ state: { status: "running" } }), 5)).toBeUndefined()
    expect(terminalToolObservation(toolPart({ tool: "todowrite" }), 6)).toBeUndefined()
  })

  test("derives bounded failure evidence from error calls only", () => {
    const failed = terminalToolObservation(
      toolPart({ state: { status: "error", input: { command: "false" }, error: "exit 1" } }),
      4,
    )!
    expect(failureFromTool(failed)).toEqual({ seq: 4, tool: "bash", evidence: "bash: exit 1" })
    const completed = terminalToolObservation(toolPart(), 3)!
    expect(failureFromTool(completed)).toBeUndefined()
  })
})

describe("assistant text and todos", () => {
  test("collects completed non-synthetic text parts only", () => {
    expect(assistantTextFromPart({ type: "text", text: "done", time: { end: 1 } })).toBe("done")
    expect(assistantTextFromPart({ type: "text", text: "done", time: {} })).toBeUndefined()
    expect(assistantTextFromPart({ type: "text", text: "done", synthetic: true, time: { end: 1 } })).toBeUndefined()
    expect(assistantTextFromPart({ type: "reasoning", text: "thinking", time: { end: 1 } })).toBeUndefined()
  })

  test("validates todo arrays strictly", () => {
    expect(todoObservations([{ content: "a", status: "pending", priority: "high" }])).toEqual([
      { content: "a", status: "pending", priority: "high" },
    ])
    expect(todoObservations([{ content: "a", status: "pending" }])).toBeUndefined()
    expect(todoObservations(undefined)).toBeUndefined()
    expect(todoObservations("nope")).toBeUndefined()
  })
})

describe("change fingerprints", () => {
  test("records path and counts from event-derived metadata", () => {
    const part = toolPart({
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "src/a.ts", oldString: "a", newString: "b" },
        output: "updated",
        metadata: { additions: 4, deletions: 2 },
      },
    })
    const observation = terminalToolObservation(part, 7)!
    const change = changeFingerprintFromTool(observation, part)
    expect(change).toMatchObject({ seq: 7, path: "src/a.ts", additions: 4, deletions: 2 })
    expect(change!.fingerprint).toHaveLength(64)
  })

  test("reads counts from filediff metadata when top-level counts are absent", () => {
    const part = toolPart({
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "src/b.ts", oldString: "a", newString: "b" },
        output: "updated",
        metadata: { filediff: { file: "src/b.ts", patch: "…", additions: 16, deletions: 15 } },
      },
    })
    const observation = terminalToolObservation(part, 9)!
    const change = changeFingerprintFromTool(observation, part)
    expect(change).toMatchObject({ seq: 9, path: "src/b.ts", additions: 16, deletions: 15 })
  })

  test("omits changes without a trustworthy path", () => {
    const part = toolPart({ state: { status: "completed", input: { command: "echo hi" }, output: "hi" } })
    const observation = terminalToolObservation(part, 8)!
    expect(changeFingerprintFromTool(observation, part)).toBeUndefined()
  })

  test("fingerprints differ for changed content at the same path", () => {
    const first = toolPart({ tool: "edit", state: { status: "completed", input: { filePath: "a.ts" }, output: "v1" } })
    const second = toolPart({ tool: "edit", state: { status: "completed", input: { filePath: "a.ts" }, output: "v2" } })
    const firstChange = changeFingerprintFromTool(terminalToolObservation(first, 1)!, first)!
    const secondChange = changeFingerprintFromTool(terminalToolObservation(second, 2)!, second)!
    expect(firstChange.fingerprint).not.toBe(secondChange.fingerprint)
  })
})
