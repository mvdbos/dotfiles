import { describe, expect, test } from "bun:test"
import { decideIdle, parseSseLoopChunk, toastFor, toPromptParts } from "./helpers"

function loopChunk() {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, finish_reason: "length", finish_details: { type: "repetition_loop" } }],
  })}\n\n`
}

describe("decideIdle", () => {
  test("no pending turns is a no-op", () => {
    expect(decideIdle({ pending: [], attempts: new Map(), retries: 3 })).toEqual({ kind: "none" })
  })

  test("child sessions are skipped", () => {
    expect(
      decideIdle({ pending: ["s:u"], attempts: new Map(), retries: 3, parentID: "parent" }),
    ).toEqual({ kind: "skip-child" })
  })

  test("first loop retries with attempt 1", () => {
    expect(decideIdle({ pending: ["s:u"], attempts: new Map(), retries: 3 })).toEqual({
      kind: "retry",
      attempt: 1,
    })
  })

  test("later loops advance the attempt counter", () => {
    expect(decideIdle({ pending: ["s:u"], attempts: new Map([["s:u", 2]]), retries: 3 })).toEqual({
      kind: "retry",
      attempt: 3,
    })
  })

  test("exhausted retries give up", () => {
    expect(decideIdle({ pending: ["s:u"], attempts: new Map([["s:u", 3]]), retries: 3 })).toEqual({
      kind: "give-up",
    })
    expect(decideIdle({ pending: ["s:u"], attempts: new Map([["s:u", 9]]), retries: 3 })).toEqual({
      kind: "give-up",
    })
  })

  test("the most recent pending turn wins", () => {
    expect(
      decideIdle({ pending: ["s:old", "s:new"], attempts: new Map([["s:old", 2]]), retries: 3 }),
    ).toEqual({ kind: "retry", attempt: 1 })
  })
})

describe("toPromptParts", () => {
  test("keeps text parts and skips synthetic or unknown parts", () => {
    expect(
      toPromptParts([
        { id: "p1", type: "text", text: "hello" },
        { id: "p2", type: "text", text: "internal", synthetic: true },
        { id: "p3", type: "reasoning", text: "thinking" },
        { id: "p4", type: "step-start" },
        { id: "p5", type: "tool", tool: "bash" },
      ]),
    ).toEqual([{ id: "p1", type: "text", text: "hello" }])
  })

  test("preserves image file parts", () => {
    expect(
      toPromptParts([
        {
          id: "f1",
          type: "file",
          mime: "image/png",
          filename: "shot.png",
          url: "data:image/png;base64,AAAA",
          source: { type: "file", path: "shot.png" },
        },
      ]),
    ).toEqual([
      {
        id: "f1",
        type: "file",
        mime: "image/png",
        filename: "shot.png",
        url: "data:image/png;base64,AAAA",
        source: { type: "file", path: "shot.png" },
      },
    ])
  })

  test("preserves agent and subtask parts", () => {
    expect(
      toPromptParts([
        { type: "agent", name: "build", source: { value: "@build", start: 0, end: 6 } },
        { type: "subtask", prompt: "explore", description: "look around", agent: "explore" },
      ]),
    ).toEqual([
      { type: "agent", name: "build", source: { value: "@build", start: 0, end: 6 } },
      { type: "subtask", prompt: "explore", description: "look around", agent: "explore" },
    ])
  })

  test("malformed input maps to an empty array", () => {
    expect(toPromptParts(undefined)).toEqual([])
    expect(toPromptParts([{ type: "file", mime: "image/png" }])).toEqual([])
  })
})

describe("toastFor", () => {
  test("attempt toast names the attempt and total", () => {
    expect(toastFor("attempt", 2, 3)).toEqual({
      title: "mlx-serve",
      message: "Repeated output loop — retrying 2/3",
      variant: "warning",
    })
  })

  test("exhaustion toast reports the retry budget", () => {
    expect(toastFor("exhausted", 3, 3)).toEqual({
      title: "mlx-serve",
      message: "Repeated output loop — gave up after 3 retries",
      variant: "error",
    })
  })
})

describe("parseSseLoopChunk", () => {
  test("detects a complete repetition_loop chunk", () => {
    const scan = parseSseLoopChunk(loopChunk())
    expect(scan.hit).toBe(true)
    expect(scan.rest).toBe("")
  })

  test("keeps a partial trailing line across reads", () => {
    const payload = loopChunk()
    const first = parseSseLoopChunk(payload.slice(0, 20))
    expect(first.hit).toBe(false)
    expect(first.rest).toBe(payload.slice(0, 20))

    const second = parseSseLoopChunk(first.rest + payload.slice(20))
    expect(second.hit).toBe(true)
    expect(second.rest).toBe("")
  })

  test("handles CRLF separators", () => {
    const scan = parseSseLoopChunk(loopChunk().replaceAll("\n", "\r\n"))
    expect(scan.hit).toBe(true)
    expect(scan.rest).toBe("")
  })

  test("plain length finishes are not loop hits", () => {
    const payload = `data: ${JSON.stringify({ choices: [{ finish_reason: "length" }] })}\n\n`
    expect(parseSseLoopChunk(payload)).toEqual({ hit: false, rest: "" })
  })

  test("ignores [DONE], comments and malformed JSON", () => {
    expect(parseSseLoopChunk("data: [DONE]\n\n")).toEqual({ hit: false, rest: "" })
    expect(parseSseLoopChunk(": keep-alive\n\n")).toEqual({ hit: false, rest: "" })
    expect(parseSseLoopChunk("data: {not json\n\n")).toEqual({ hit: false, rest: "" })
  })

  test("hits while preserving a partial trailing line", () => {
    const scan = parseSseLoopChunk(loopChunk() + "data: {\"choices\"")
    expect(scan.hit).toBe(true)
    expect(scan.rest).toBe("data: {\"choices\"")
  })
})
