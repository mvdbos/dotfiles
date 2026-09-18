/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { CriticRunner, isContextOverflow, type CriticClient, type CriticPromptBody } from "./critic"

type PromptCall = { childID: string; body: CriticPromptBody }

function fakeClient(options: {
  promptResults: Array<
    | { text?: string; error?: unknown; hold?: Promise<void> }
    | ((call: PromptCall) => { text?: string; error?: unknown; hold?: Promise<void> })
  >
  toolIDs?: string[]
}) {
  const events: string[] = []
  const prompts: PromptCall[] = []
  let created = 0
  const client: CriticClient = {
    tool: {
      ids: async () => {
        events.push("tool.ids")
        return { data: options.toolIDs ?? ["bash", "edit", "write"] }
      },
    },
    session: {
      create: async () => {
        created += 1
        const id = `child-${created}`
        events.push(`create:${id}`)
        return { data: { id } }
      },
      prompt: async ({ path, body }) => {
        events.push(`prompt:${path.id}`)
        prompts.push({ childID: path.id, body })
        const index = prompts.length - 1
        const entry = options.promptResults[index]
        const result = typeof entry === "function" ? entry({ childID: path.id, body }) : entry
        if (result?.hold) await result.hold
        if (result?.error !== undefined) return { error: result.error }
        return { data: { info: {}, parts: [{ type: "text", text: result?.text ?? '{"status":"ok"}' }] } }
      },
      abort: async ({ path }) => {
        events.push(`abort:${path.id}`)
      },
      delete: async ({ path }) => {
        events.push(`delete:${path.id}`)
      },
    },
  }
  return { client, events, prompts }
}

const baseOptions = {
  rootSessionID: "root",
  agent: "watchdog-critic",
  model: { providerID: "mock", modelID: "critic" },
  prompt: "packet",
  timeoutMs: 1_000,
}

describe("CriticRunner", () => {
  test("prompts a fresh parent-linked child with every tool disabled and deletes it normally", async () => {
    const { client, events, prompts } = fakeClient({
      promptResults: [{ text: '{"status":"ok"}' }],
    })
    const disposed: Array<[string, boolean]> = []
    const runner = new CriticRunner({
      client,
      onChildCreated: (id) => events.push(`register:${id}`),
      onChildDisposed: (id, deleted) => disposed.push([id, deleted]),
    })

    const result = await runner.run(baseOptions)
    expect(result.kind).toBe("ok")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.body.agent).toBe("watchdog-critic")
    expect(prompts[0]!.body.model).toEqual({ providerID: "mock", modelID: "critic" })
    expect(prompts[0]!.body.tools).toEqual({ bash: false, edit: false, write: false })
    expect(prompts[0]!.body.parts).toEqual([{ type: "text", text: "packet" }])
    expect(events).toEqual(["create:child-1", "register:child-1", "tool.ids", "prompt:child-1", "delete:child-1"])
    expect(disposed).toEqual([["child-1", true]])
  })

  test("returns a parsed concern from the completed assistant text", async () => {
    const message = "The same failing command was repeated three times with identical errors."
    const { client } = fakeClient({
      promptResults: [
        { text: JSON.stringify({ status: "concern", severity: "warning", category: "repeated_failure", message }) },
      ],
    })
    const runner = new CriticRunner({ client })
    const result = await runner.run(baseOptions)
    expect(result.kind).toBe("concern")
    if (result.kind === "concern") {
      expect(result.concern).toEqual({ severity: "warning", category: "repeated_failure", message })
    }
  })

  test("retries malformed output exactly once and returns the final malformed result", async () => {
    const { client, events } = fakeClient({ promptResults: [{ text: "not json" }, { text: "still not json" }] })
    const runner = new CriticRunner({ client })
    const result = await runner.run(baseOptions)
    expect(result).toMatchObject({ kind: "malformed" })
    expect(events.filter((event) => event.startsWith("create:"))).toHaveLength(2)
    expect(events.at(-1)).toBe("delete:child-2")
  })

  test("handles a successful retry as a normal critic result", async () => {
    const { client, prompts, events } = fakeClient({
      promptResults: [{ text: "not json" }, { text: '{"status":"ok"}' }],
    })
    const runner = new CriticRunner({ client })
    const result = await runner.run(baseOptions)
    expect(result).toMatchObject({ kind: "ok", attempts: 2, retryReasons: ["malformed_output"] })
    expect(prompts).toHaveLength(2)
    expect(prompts.map((call) => call.childID)).toEqual(["child-1", "child-2"])
    expect(events).toEqual([
      "create:child-1",
      "tool.ids",
      "prompt:child-1",
      "delete:child-1",
      "create:child-2",
      "tool.ids",
      "prompt:child-2",
      "delete:child-2",
    ])
  })

  test("aborts the server-side runner before deleting on timeout", async () => {
    let release: (() => void) | undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { client, events } = fakeClient({ promptResults: [{ hold }] })
    const runner = new CriticRunner({ client })
    const result = await runner.run({ ...baseOptions, timeoutMs: 10 })
    expect(result.kind).toBe("timeout")
    expect(events).toEqual(["create:child-1", "tool.ids", "prompt:child-1", "abort:child-1", "delete:child-1"])
    release?.()
  })

  test("aborts and deletes when cancelled mid-flight", async () => {
    let release: (() => void) | undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { client, events } = fakeClient({ promptResults: [{ hold }] })
    const runner = new CriticRunner({ client })
    const controller = new AbortController()
    const started = runner.run({ ...baseOptions, signal: controller.signal })
    await Bun.sleep(10)
    controller.abort()
    const result = await started
    expect(result.kind).toBe("cancelled")
    expect(events).toContain("abort:child-1")
    expect(events.at(-1)).toBe("delete:child-1")
    release?.()
  })

  test("retries once in a fresh child with the minimal packet on context overflow", async () => {
    const { client, events, prompts } = fakeClient({
      promptResults: [
        { error: { data: { message: "This model's maximum context length is 8192 tokens" } } },
        { text: '{"status":"ok"}' },
      ],
    })
    const runner = new CriticRunner({ client })
    const result = await runner.run({ ...baseOptions, minimalPrompt: "minimal" })
    expect(result).toMatchObject({ kind: "ok", minimalRetry: true })
    expect(prompts.map((call) => call.body.parts[0]!.text)).toEqual(["packet", "minimal"])
    expect(prompts.map((call) => call.childID)).toEqual(["child-1", "child-2"])
    expect(events).toEqual([
      "create:child-1",
      "tool.ids",
      "prompt:child-1",
      "abort:child-1",
      "delete:child-1",
      "create:child-2",
      "tool.ids",
      "prompt:child-2",
      "delete:child-2",
    ])
  })

  test("does not retry context overflow without a minimal prompt", async () => {
    const { client, events } = fakeClient({
      promptResults: [{ error: { data: { message: "maximum context length exceeded" } } }],
    })
    const runner = new CriticRunner({ client })
    const result = await runner.run(baseOptions)
    expect(result.kind).toBe("context_overflow")
    expect(events.filter((event) => event.startsWith("create:"))).toHaveLength(1)
  })

  test("treats provider errors as fail-open errors and still deletes the child", async () => {
    const { client, events } = fakeClient({ promptResults: [{ error: { data: { message: "auth failed" } } }] })
    const runner = new CriticRunner({ client })
    const result = await runner.run(baseOptions)
    expect(result).toMatchObject({ kind: "error", detail: "auth failed" })
    expect(events.at(-1)).toBe("delete:child-1")
  })

  test("classifies only positively identified context overflow", () => {
    expect(isContextOverflow({ data: { message: "maximum context length exceeded" } })).toBe(true)
    expect(isContextOverflow({ data: { message: "prompt is too long" } })).toBe(true)
    expect(isContextOverflow({ data: { message: "authentication failed" } })).toBe(false)
    expect(isContextOverflow(undefined)).toBe(false)
  })
})
