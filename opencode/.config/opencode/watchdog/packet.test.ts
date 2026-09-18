/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import {
  boundEvidence,
  buildCriticPrompt,
  canonicalPacketJson,
  evidenceFingerprint,
  fitUserPrompt,
  headTailText,
  materializePacket,
  MINIMAL_PACKET_BUDGETS,
  PACKET_BUDGETS,
  sanitizeText,
  snapshotKey,
  type ClaimedEvidence,
  type WatchdogPacket,
} from "./packet"
import { MAX_USER_PROMPT_BYTES } from "./prompt"

function packet(overrides: Partial<WatchdogPacket> = {}): WatchdogPacket {
  return {
    version: 1,
    trigger: "cadence",
    task: { original: "Build the feature.", current: "Build the feature." },
    tools: [
      { seq: 1, name: "bash", status: "completed", sincePreviousCheck: true, input: "ls", result: "a\nb" },
      { seq: 2, name: "edit", status: "completed", sincePreviousCheck: true, input: "write x", result: "ok" },
    ],
    ...overrides,
  }
}

function claimed(overrides: Partial<ClaimedEvidence> = {}): ClaimedEvidence {
  return {
    task: { original: "Build the feature.", current: "Build the feature." },
    tools: [
      { seq: 1, name: "bash", status: "completed", input: "ls", result: "a" },
      { seq: 5, name: "edit", status: "completed", input: "write x", result: "ok" },
      { seq: 9, name: "bash", status: "error", input: "run tests", result: "2 failed" },
    ],
    failureCandidates: [
      { seq: 3, tool: "bash", evidence: "old failure" },
      { seq: 9, tool: "bash", evidence: "new failure" },
    ],
    changeFingerprints: [
      { seq: 5, path: "src/a.ts", additions: 3, deletions: 1, fingerprint: "hash-a" },
      { seq: 9, path: "src/b.ts", additions: 1, deletions: 0, fingerprint: "hash-b" },
    ],
    ...overrides,
  }
}

describe("packet bounds", () => {
  test("sanitizes control characters without breaking JSON", () => {
    const input = "a\u0000b\u0001c\nd\te😀"
    const sanitized = sanitizeText(input)
    expect(sanitized).toBe("a\\0b\\u0001c\nd\te😀")
    expect(JSON.parse(JSON.stringify({ sanitized })).sanitized).toBe(sanitized)
  })

  test("head and tail never split surrogate pairs", () => {
    const text = "😀".repeat(10)
    const head = headTailText(text, 7)
    expect([...head].every((character) => character === "…" || character === "😀")).toBe(true)
    expect(Array.from(head).length).toBeLessThanOrEqual(7)
  })

  test("keeps the final UTF-8 prompt within 16,384 bytes for hostile fixtures", () => {
    const hostile = `"\\\u0000😀é`.repeat(400)
    const evidence = boundEvidence(
      claimed({
        task: { original: hostile.repeat(10), current: hostile.repeat(10) },
        recentAssistantText: hostile.repeat(10),
        todos: Array.from({ length: 30 }, () => ({ content: hostile, status: "pending", priority: "low" })),
        failureCandidates: Array.from({ length: 10 }, (_, index) => ({ seq: index + 1, tool: "bash", evidence: hostile })),
        tools: Array.from({ length: 12 }, (_, index) => ({
          seq: index + 1,
          name: "bash",
          status: "completed" as const,
          input: hostile,
          result: hostile,
        })),
      }),
      { maxRecentTools: 12 },
    )
    const materialized = materializePacket(evidence, "cadence", {
      lastCheckToolSeq: 0,
      previousChangeHashes: new Map(),
    })
    const result = fitUserPrompt(materialized)
    if ("error" in result) throw new Error(result.error)
    expect(Buffer.byteLength(result.prompt, "utf8")).toBeLessThanOrEqual(MAX_USER_PROMPT_BYTES)
    expect(result.omissions.length).toBeGreaterThan(0)
  })

  test("preserves required task text and revalidation candidates through reduction", () => {
    const result = fitUserPrompt(
      packet({
        task: { original: "A".repeat(1795), current: "B".repeat(1500) },
        recentAssistantText: "C".repeat(1200),
        todos: [{ content: "todo", status: "pending", priority: "low" }],
        revalidateConcern: {
          severity: "warning",
          category: "plan_drift",
          message: "The plan drifted from the explicit requirement.",
        },
      }),
    )
    if ("error" in result) throw new Error(result.error)
    expect(result.packet.revalidateConcern).toBeDefined()
    expect(Buffer.byteLength(result.prompt, "utf8")).toBeLessThanOrEqual(MAX_USER_PROMPT_BYTES)
  })

  test("fails when no task text can be bounded", () => {
    const result = fitUserPrompt(packet({ task: { original: "", current: "" } }))
    expect("error" in result).toBe(true)
  })

  test("boundEvidence caps tool count and per-tool content deterministically", () => {
    const evidence = claimed({
      tools: Array.from({ length: 20 }, (_, index) => ({
        seq: index + 1,
        name: "bash",
        status: "completed" as const,
        input: `input-${index}-${"x".repeat(500)}`,
        result: `result-${index}-${"y".repeat(900)}`,
      })),
    })
    const bounded = boundEvidence(evidence, { maxRecentTools: 12 })
    expect(bounded.tools.length).toBeLessThanOrEqual(12)
    expect(bounded.tools.length).toBeGreaterThan(0)
    expect(bounded.tools[0]!.seq).toBe(20)
    for (const tool of bounded.tools) {
      expect(tool.input.length).toBeLessThanOrEqual(PACKET_BUDGETS.toolInputHead)
      expect(tool.result.length).toBeLessThanOrEqual(PACKET_BUDGETS.toolResultHead + PACKET_BUDGETS.toolResultTail + 2)
    }
    const totalChars = bounded.tools.reduce((total, tool) => total + tool.input.length + tool.result.length, 0)
    expect(totalChars).toBeLessThanOrEqual(PACKET_BUDGETS.tools)
    if (bounded.tools.length < 12) {
      expect(bounded.omittedBeforeToolSeq).toBeDefined()
    }
  })

  test("minimal packet budgets shrink the packet", () => {
    const evidence = claimed({
      tools: Array.from({ length: 12 }, (_, index) => ({
        seq: index + 1,
        name: "bash",
        status: "completed" as const,
        input: "x".repeat(600),
        result: "y".repeat(1200),
      })),
      recentAssistantText: "z".repeat(2000),
    })
    const minimal = boundEvidence(evidence, { maxRecentTools: 4, budgets: MINIMAL_PACKET_BUDGETS })
    expect(minimal.tools.length).toBeLessThanOrEqual(4)
    expect(minimal.tools.length).toBeGreaterThan(0)
    const totalChars = minimal.tools.reduce((total, tool) => total + tool.input.length + tool.result.length, 0)
    expect(totalChars).toBeLessThanOrEqual(MINIMAL_PACKET_BUDGETS.tools)
    for (const tool of minimal.tools) {
      expect(tool.input.length).toBeLessThanOrEqual(MINIMAL_PACKET_BUDGETS.toolInputHead)
    }
    expect(minimal.recentAssistantText!.length).toBeLessThanOrEqual(MINIMAL_PACKET_BUDGETS.assistant)
  })
})

describe("materialization", () => {
  test("marks freshness against the previous sequence baseline and prioritizes fresh failures", () => {
    const materialized = materializePacket(claimed(), "cadence", {
      lastCheckToolSeq: 6,
      previousChangeHashes: new Map([["src/a.ts", "hash-a"]]),
    })
    expect(materialized.tools[0]!.seq).toBe(9)
    expect(materialized.tools.find((tool) => tool.seq === 9)!.sincePreviousCheck).toBe(true)
    expect(materialized.tools.find((tool) => tool.seq === 5)!.sincePreviousCheck).toBe(false)
    expect(materialized.failures!.map((failure) => failure.evidence)).toEqual(["new failure", "old failure"])
    const changeA = materialized.changes!.find((change) => change.path === "src/a.ts")
    const changeB = materialized.changes!.find((change) => change.path === "src/b.ts")
    expect(changeA!.changedSincePreviousCheck).toBe(false)
    expect(changeB!.changedSincePreviousCheck).toBe(true)
  })

  test("revalidations carry the candidate without internal identifiers", () => {
    const candidate = {
      severity: "warning" as const,
      category: "plan_drift" as const,
      message: "The plan drifted from the explicit requirement.",
      sourceEpoch: 2,
      evidenceFingerprint: "abc",
    }
    const withCandidate = materializePacket(claimed(), "revalidation", {
      lastCheckToolSeq: 0,
      previousChangeHashes: new Map(),
    }, candidate)
    const withoutCandidate = materializePacket(claimed(), "cadence", {
      lastCheckToolSeq: 0,
      previousChangeHashes: new Map(),
    })
    expect(withCandidate.revalidateConcern).toEqual({
      severity: "warning",
      category: "plan_drift",
      message: "The plan drifted from the explicit requirement.",
    })
    expect(withoutCandidate.revalidateConcern).toBeUndefined()
  })

  test("previous concern is projected without its internal fingerprint", () => {
    const materialized = materializePacket(
      claimed({
        previousConcern: {
          category: "repeated_failure",
          message: "The same test failed repeatedly with identical errors.",
          evidenceFingerprint: "abc",
        },
      }),
      "cadence",
      { lastCheckToolSeq: 0, previousChangeHashes: new Map() },
    )
    expect(materialized.previousConcern).toEqual({
      category: "repeated_failure",
      message: "The same test failed repeatedly with identical errors.",
    })
  })
})

describe("evidence identity", () => {
  test("ignores opaque identifiers but reflects changed facts", () => {
    const first = packet()
    const withIds = packet({
      recentAssistantText: undefined,
      tools: first.tools.map((tool, index) => ({ ...tool, callID: `opaque-${index}`, partID: `part-${index}` })) as never,
    })
    expect(evidenceFingerprint(withIds)).toBe(evidenceFingerprint(first))
    const changed = packet({
      tools: first.tools.map((tool) => (tool.seq === 2 ? { ...tool, result: "changed" } : tool)),
    })
    expect(evidenceFingerprint(changed)).not.toBe(evidenceFingerprint(first))
  })

  test("repeated identical tool occurrences change the fingerprint", () => {
    const once = packet({ tools: [{ seq: 1, name: "bash", status: "completed", sincePreviousCheck: true, input: "a", result: "b" }] })
    const twice = packet({
      tools: [
        { seq: 1, name: "bash", status: "completed", sincePreviousCheck: true, input: "a", result: "b" },
        { seq: 2, name: "bash", status: "completed", sincePreviousCheck: true, input: "a", result: "b" },
      ],
    })
    expect(evidenceFingerprint(once)).not.toBe(evidenceFingerprint(twice))
  })

  test("snapshot keys are stable and separate from evidence", () => {
    expect(snapshotKey("assistant-1", 7)).toBe(snapshotKey("assistant-1", 7))
    expect(snapshotKey("assistant-1", 7)).not.toBe(snapshotKey("assistant-2", 7))
  })

  test("canonical serialization uses stable field order", () => {
    const a = canonicalPacketJson(packet())
    const b = canonicalPacketJson(packet())
    expect(a).toBe(b)
    expect(a.indexOf('"version"')).toBeLessThan(a.indexOf('"trigger"'))
    expect(a.indexOf('"trigger"')).toBeLessThan(a.indexOf('"task"'))
  })

  test("the critic prompt wrapper is fixed around the canonical packet", () => {
    const prompt = buildCriticPrompt(packet())
    expect(prompt.startsWith("Inspect this bounded observation packet.")).toBe(true)
    expect(prompt.endsWith("</watchdog_packet>")).toBe(true)
  })

  test("short tool results are preserved once, not duplicated by head+tail", () => {
    const bounded = boundEvidence(
      { task: { original: "t", current: "t" }, tools: [{ seq: 1, name: "bash", status: "completed", input: "i", result: "SHORT" }] },
      { maxRecentTools: 4 },
    )
    expect(bounded.tools[0]!.result).toBe("SHORT")
  })

  test("reduction removes the oldest successful tool first", () => {
    const tool = (seq: number) => ({
      seq,
      name: "edit",
      status: "completed" as const,
      sincePreviousCheck: true,
      input: "x".repeat(280),
      result: "y".repeat(560),
    })
    const packet = materializePacket(
      { task: { original: "t", current: "t" }, tools: [tool(1), tool(2), tool(3)] },
      "cadence",
      { lastCheckToolSeq: 0, previousChangeHashes: new Map() },
    )
    const fitted = fitUserPrompt(packet, { maxBytes: 2200 })
    if ("error" in fitted) throw new Error(fitted.error)
    expect(fitted.packet.tools.length).toBeGreaterThan(0)
    expect(fitted.packet.tools.length).toBeLessThan(3)
    expect(fitted.packet.tools.map((entry) => entry.seq)).toContain(3)
    expect(fitted.packet.tools.map((entry) => entry.seq)).not.toContain(1)
  })

  test("fingerprints describe the final reduced packet, not the untruncated evidence", () => {
    const emoji = "😀".repeat(3000)
    const tool = (seq: number) => ({
      seq,
      name: "bash",
      status: "completed" as const,
      input: emoji,
      result: emoji,
    })
    const evidence = boundEvidence(
      {
        task: { original: emoji, current: emoji },
        tools: [tool(1), tool(2), tool(3), tool(4)],
        recentAssistantText: emoji,
      },
      { maxRecentTools: 4 },
    )
    const packet = materializePacket(evidence, "cadence", {
      lastCheckToolSeq: 0,
      previousChangeHashes: new Map(),
    })
    const fitted = fitUserPrompt(packet)
    if ("error" in fitted) throw new Error(fitted.error)
    expect(fitted.omissions.length).toBeGreaterThan(0)
    expect(evidenceFingerprint(fitted.packet)).not.toBe(evidenceFingerprint(packet))
  })
})
