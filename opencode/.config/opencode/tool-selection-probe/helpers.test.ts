/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import {
  evidenceOf,
  formatReport,
  matchesExpectation,
  outcomeLabel,
  runPasses,
  summarize,
  type ProbeCue,
  type ProbeRun,
} from "./helpers"

const textPart = (text: string) => ({ type: "text", text })
const taskPart = (subagent: string, description = "focused task") => ({
  type: "tool",
  tool: "task",
  callID: `call_${subagent}`,
  state: { status: "completed", input: { subagent_type: subagent, description, prompt: "do work" } },
})
const questionPart = (header: string) => ({
  type: "tool",
  tool: "question",
  callID: "call_question",
  state: { status: "completed", input: { questions: [{ header, question: "pick one", options: [] }] } },
})
const assistant = (parts: Array<Record<string, any>>, completed = true) => ({
  info: { role: "assistant", time: completed ? { completed: 1 } : {} },
  parts,
})
const user = (text: string) => ({ info: { role: "user" }, parts: [textPart(text)] })

const cue = (overrides: Partial<ProbeCue>): ProbeCue => ({
  id: "cue",
  expectation: "task:explore",
  forbidden: [],
  prompt: "prompt",
  ...overrides,
})

const run = (overrides: Partial<ProbeRun>): ProbeRun => ({
  cue: "cue",
  repetition: 1,
  sessionID: "ses_test",
  elapsedMs: 1000,
  timedOut: false,
  aborted: false,
  evidence: { assistantText: false, completed: true, taskCalls: [], questionCalls: [] },
  ...overrides,
})

describe("evidence extraction", () => {
  test("reads task calls with their subagent and user text parts are ignored", () => {
    const evidence = evidenceOf([
      user("please explore"),
      assistant([textPart("Here is the map"), taskPart("explore", "map sync flow")]),
    ])
    expect(evidence.completed).toBe(true)
    expect(evidence.assistantText).toBe(true)
    expect(evidence.taskCalls).toEqual([{ subagent: "explore", description: "map sync flow", status: "completed" }])
    expect(evidence.questionCalls).toEqual([])
  })

  test("reads question calls and headers", () => {
    const evidence = evidenceOf([user("improve it"), assistant([questionPart("Which area?")], false)])
    expect(evidence.completed).toBe(false)
    expect(evidence.questionCalls).toEqual([{ header: "Which area?", status: "completed" }])
  })

  test("tolerates parts without state input", () => {
    const evidence = evidenceOf([
      assistant([{ type: "tool", tool: "task" }, { type: "tool", tool: "question" }]),
    ])
    expect(evidence.taskCalls).toEqual([{ subagent: "unknown", description: undefined, status: "unknown" }])
    expect(evidence.questionCalls).toEqual([{ header: undefined, status: "unknown" }])
  })
})

describe("expectation matching", () => {
  test("classifies direct, delegated, and questioned runs", () => {
    expect(outcomeLabel(evidenceOf([assistant([textPart("answer")])]))).toBe("direct")
    expect(outcomeLabel(evidenceOf([assistant([taskPart("explore"), taskPart("general")])]))).toBe(
      "task:explore+task:general",
    )
    expect(outcomeLabel(evidenceOf([assistant([questionPart("Which?")])]))).toBe("question")
  })

  test("matches expected and forbidden outcomes", () => {
    const delegated = evidenceOf([assistant([taskPart("general")])])
    expect(matchesExpectation(delegated, "task:general")).toBe(true)
    expect(matchesExpectation(delegated, "task:explore")).toBe(false)
    expect(matchesExpectation(delegated, "question")).toBe(false)
    expect(matchesExpectation(delegated, "none")).toBe(false)
  })

  test("fails a cue when the expected outcome is absent", () => {
    const spec = cue({ expectation: "task:explore" })
    expect(runPasses(spec, run({ evidence: evidenceOf([assistant([textPart("did it myself")])]) }))).toBe(false)
  })

  test("fails a cue when a forbidden outcome appears", () => {
    const spec = cue({ expectation: "task:explore", forbidden: ["task:general"] })
    const evidence = evidenceOf([assistant([taskPart("explore"), taskPart("general")])])
    expect(runPasses(spec, run({ evidence }))).toBe(false)
  })

  test("fails the control cue when the turn never completes", () => {
    const spec = cue({ id: "narrow-lookup", expectation: "none", forbidden: ["question", "task:explore"] })
    const incomplete = evidenceOf([user("what is the name?"), assistant([textPart("...")], false)])
    expect(runPasses(spec, run({ cue: "narrow-lookup", evidence: incomplete }))).toBe(false)
    const complete = evidenceOf([assistant([textPart("ledger-sync")])])
    expect(runPasses(spec, run({ cue: "narrow-lookup", evidence: complete }))).toBe(true)
  })

  test("passes a question run even though it was aborted before completion", () => {
    const spec = cue({ expectation: "question" })
    const evidence = evidenceOf([assistant([questionPart("Which area?")], false)])
    expect(runPasses(spec, run({ aborted: true, timedOut: true, evidence }))).toBe(true)
  })
})

describe("summarize and report", () => {
  const cues = [
    cue({ id: "exploration", expectation: "task:explore", forbidden: ["task:general"] }),
    cue({ id: "user-input", expectation: "question" }),
  ]
  const runs = [
    run({ cue: "exploration", repetition: 1, evidence: evidenceOf([assistant([taskPart("explore")])]) }),
    run({ cue: "exploration", repetition: 2, evidence: evidenceOf([assistant([taskPart("explore")])]) }),
    run({ cue: "exploration", repetition: 3, evidence: evidenceOf([assistant([textPart("diy")])]) }),
    run({ cue: "user-input", repetition: 1, evidence: evidenceOf([assistant([questionPart("Which?")], false)]) }),
    run({ cue: "user-input", repetition: 2, evidence: evidenceOf([assistant([textPart("I choose")])]) }),
    run({ cue: "user-input", repetition: 3, evidence: evidenceOf([assistant([textPart("I choose")])]) }),
  ]

  test("computes per-cue majorities", () => {
    const summary = summarize(cues, runs)
    expect(summary.map((row) => [row.id, row.passes, row.runs, row.majority])).toEqual([
      ["exploration", 2, 3, true],
      ["user-input", 1, 3, false],
    ])
    expect(summary[0]!.observed).toEqual({ "task:explore": 2, direct: 1 })
  })

  test("renders a report with expectations, observed outcomes, and evidence", () => {
    const report = formatReport(
      { model: "ds4/qwen3.8-flash-next", configDir: "/tmp/opencode", repetitions: 3 },
      cues,
      runs,
    )
    expect(report).toContain("model ds4/qwen3.8-flash-next")
    expect(report).toContain("exploration")
    expect(report).toContain("task:explore x2")
    expect(report).toContain("result: FAIL")
    expect(report).toContain("ses_test")
  })
})
