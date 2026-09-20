import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk"
import {
  baselineKeyOf,
  countWorkSince,
  findTodoWriteBaseline,
  formatTodoNudge,
  shouldNudge,
  visibleTodoWritePart,
  type NudgeConfig,
  type NudgeMessage,
} from "../src/nudge"

const BASE = 1_000_000

const policy: NudgeConfig = {
  enabled: true,
  toolThreshold: 3,
  minutesThreshold: 5,
}

function message(id: string, created: number, parts: Part[], options: { role?: string; error?: unknown } = {}): NudgeMessage {
  return {
    info: {
      id,
      role: options.role ?? "assistant",
      time: { created },
      ...(options.error ? { error: options.error } : {}),
    },
    parts,
  }
}

type TodoPartOptions = {
  start?: number
  end?: number
  compacted?: boolean
  hidden?: boolean
  failed?: boolean
}

function todoPart(id: string, messageID: string, options: TodoPartOptions = {}): Part {
  const start = options.start ?? BASE
  const end = options.end ?? start + 2
  if (options.failed) {
    return {
      id,
      sessionID: "s1",
      messageID,
      type: "tool",
      callID: `call-${id}`,
      tool: "todowrite",
      state: { status: "error", input: {}, error: "failed", time: { start, end } },
    } as unknown as Part
  }
  return {
    id,
    sessionID: "s1",
    messageID,
    type: "tool",
    callID: `call-${id}`,
    tool: "todowrite",
    ...(options.hidden ? { metadata: { hidden: true } } : {}),
    state: {
      status: "completed",
      input: { todos: [] },
      output: "todos written",
      title: "todowrite",
      metadata: options.hidden ? { hidden: true } : {},
      time: { start, end, ...(options.compacted ? { compacted: end + 1 } : {}) },
    },
  } as unknown as Part
}

function workPart(
  id: string,
  messageID: string,
  options: { tool?: string; status?: "completed" | "error" | "running"; start?: number; end?: number } = {},
): Part {
  const tool = options.tool ?? "glob"
  const status = options.status ?? "completed"
  const start = options.start ?? BASE
  const end = options.end ?? start + 1
  if (status === "running") {
    return {
      id,
      sessionID: "s1",
      messageID,
      type: "tool",
      callID: `call-${id}`,
      tool,
      state: { status: "running", input: {}, time: { start } },
    } as unknown as Part
  }
  if (status === "error") {
    return {
      id,
      sessionID: "s1",
      messageID,
      type: "tool",
      callID: `call-${id}`,
      tool,
      state: { status: "error", input: {}, error: "boom", time: { start, end } },
    } as unknown as Part
  }
  return {
    id,
    sessionID: "s1",
    messageID,
    type: "tool",
    callID: `call-${id}`,
    tool,
    state: { status: "completed", input: {}, output: "ok", title: tool, metadata: {}, time: { start, end } },
  } as unknown as Part
}

describe("visibleTodoWritePart", () => {
  test("accepts only successful uncompacted, unhidden todowrite parts", () => {
    expect(visibleTodoWritePart(todoPart("a", "m"))).toBe(true)
    expect(visibleTodoWritePart(todoPart("b", "m", { failed: true }))).toBe(false)
    expect(visibleTodoWritePart(todoPart("c", "m", { compacted: true }))).toBe(false)
    expect(visibleTodoWritePart(todoPart("d", "m", { hidden: true }))).toBe(false)
    expect(visibleTodoWritePart(workPart("e", "m"))).toBe(false)
  })
})

describe("findTodoWriteBaseline", () => {
  test("selects the newest visible todowrite across messages", () => {
    const messages = [
      message("a1", BASE, [todoPart("t1", "a1")]),
      message("a2", BASE + 10, [workPart("w1", "a2")]),
      message("a3", BASE + 20, [todoPart("t2", "a3", { start: BASE + 20, end: BASE + 22 })]),
    ]
    const baseline = findTodoWriteBaseline(messages)!
    expect(baseline.messageID).toBe("a3")
    expect(baseline.partID).toBe("t2")
    expect(baseline.atMs).toBe(BASE + 22)
    expect(baselineKeyOf(baseline)).toBe("a3:t2")
  })

  test("ignores failed and compacted writes and later parts in one message win", () => {
    const messages = [
      message("a1", BASE, [todoPart("t1", "a1")]),
      message("a2", BASE + 10, [
        todoPart("t2", "a2", { failed: true }),
        todoPart("t3", "a2", { start: BASE + 10, end: BASE + 12 }),
        todoPart("t4", "a2", { start: BASE + 13, end: BASE + 15, compacted: true }),
      ]),
    ]
    const baseline = findTodoWriteBaseline(messages)!
    expect(baseline.partID).toBe("t3")
  })

  test("returns nothing when no visible todowrite exists", () => {
    expect(findTodoWriteBaseline([message("a1", BASE, [workPart("w1", "a1")])])).toBeUndefined()
  })
})

describe("countWorkSince", () => {
  test("counts only successful work after the baseline", () => {
    const messages = [
      message("a1", BASE, [workPart("before-1", "a1"), todoPart("t1", "a1")]),
      message("a2", BASE + 10, [
        workPart("w1", "a2", { start: BASE + 10, end: BASE + 11 }),
        workPart("w2", "a2", { status: "error", start: BASE + 11, end: BASE + 12 }),
        workPart("w3", "a2", { tool: "question", start: BASE + 12, end: BASE + 13 }),
        workPart("w4", "a2", { tool: "skill", start: BASE + 13, end: BASE + 14 }),
        workPart("w-mcp", "a2", { tool: "mcp_server_tool", start: BASE + 14, end: BASE + 15 }),
        workPart("w5", "a2", { status: "running", start: BASE + 14 }),
      ]),
      message("a3", BASE + 20, [workPart("w6", "a3", { start: BASE + 20, end: BASE + 21 })]),
    ]
    const baseline = findTodoWriteBaseline(messages)!
    expect(countWorkSince(messages, baseline)).toBe(2)
  })

  test("counts successful tools later in the baseline message", () => {
    const messages = [
      message("a1", BASE, [
        workPart("before", "a1"),
        todoPart("t1", "a1"),
        workPart("after", "a1"),
      ]),
    ]
    expect(countWorkSince(messages, findTodoWriteBaseline(messages)!)).toBe(1)
  })

  test("ignores errored assistant messages", () => {
    const messages = [
      message("a1", BASE, [todoPart("t1", "a1")]),
      message("a2", BASE + 10, [workPart("w1", "a2")], { error: { name: "APIError" } }),
    ]
    const baseline = findTodoWriteBaseline(messages)!
    expect(countWorkSince(messages, baseline)).toBe(0)
  })
})

describe("shouldNudge", () => {
  test("stays silent below both thresholds", () => {
    expect(
      shouldNudge({ config: policy, baselineKey: "a1:t1", toolCalls: 2, elapsedMs: 60_000, nowMs: BASE }),
    ).toBe(false)
  })

  test("fires once the baseline-relative threshold is crossed", () => {
    expect(
      shouldNudge({ config: policy, baselineKey: "a1:t1", toolCalls: 3, elapsedMs: 1_000, nowMs: BASE }),
    ).toBe(true)
    expect(
      shouldNudge({ config: policy, baselineKey: "a1:t1", toolCalls: 0, elapsedMs: 5 * 60_000, nowMs: BASE }),
    ).toBe(true)
  })

  test("allows at most one reminder per baseline regardless of later windows", () => {
    const last = { baselineKey: "a1:t1", toolCalls: 3, atMs: BASE }
    expect(
      shouldNudge({ config: policy, baselineKey: "a1:t1", toolCalls: 5, elapsedMs: 9_000, nowMs: BASE + 9_000, last }),
    ).toBe(false)
    expect(
      shouldNudge({ config: policy, baselineKey: "a1:t1", toolCalls: 6, elapsedMs: 10_000, nowMs: BASE + 10_000, last }),
    ).toBe(false)
    expect(
      shouldNudge({
        config: policy,
        baselineKey: "a1:t1",
        toolCalls: 4,
        elapsedMs: 5 * 60_000,
        nowMs: BASE + 5 * 60_000,
        last,
      }),
    ).toBe(false)
  })

  test("a new todowrite baseline restarts the first-nudge path", () => {
    const last = { baselineKey: "a1:t1", toolCalls: 12, atMs: BASE }
    expect(
      shouldNudge({ config: policy, baselineKey: "a2:t2", toolCalls: 3, elapsedMs: 1_000, nowMs: BASE + 1_000, last }),
    ).toBe(true)
  })

  test("disabled triggers never fire", () => {
    const disabled = { ...policy, toolThreshold: 0, minutesThreshold: 0 }
    expect(
      shouldNudge({
        config: disabled,
        baselineKey: "a1:t1",
        toolCalls: 100,
        elapsedMs: 60 * 60_000,
        nowMs: BASE,
      }),
    ).toBe(false)
  })
})

describe("formatTodoNudge", () => {
  test("uses stable text without dynamic counts or a persisted list", () => {
    const text = formatTodoNudge({ toolCalls: 12, elapsedMs: 7 * 60_000 })
    expect(text).toContain("Todo status reminder (system-generated, not a user request)")
    expect(text).not.toContain("12 tool calls")
    expect(text).not.toContain("7 min")
    expect(text).toContain("If nothing changed, ignore this reminder and continue the current task.")
    expect(text).not.toContain("Current persisted list")
  })

})
