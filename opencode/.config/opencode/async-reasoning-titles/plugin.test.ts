import { afterEach, describe, expect, test } from "bun:test"
import type { TuiPluginApi, TuiPluginMeta, TuiPluginModule } from "@opencode-ai/plugin/tui"
import plugin from "../tui-plugins/async-reasoning-titles"
import { TITLE_METADATA_KEY } from "./helpers"

type TestPart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  text: string
  metadata?: Record<string, unknown>
  time?: { start?: number; end?: number }
}

type UpdateCall = { sessionID: string; messageID: string; partID: string; part: TestPart }

const originalFetch = globalThis.fetch
let fetchCalls: Array<{ url: string; body: Record<string, any> }> = []
let respond: (init: RequestInit) => Promise<Response> = async () =>
  Response.json({ choices: [{ message: { content: "Checking alignment" } }] })

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    fetchCalls.push({ url: String(input), body })
    return respond(init ?? {})
  }) as typeof fetch
}

function jsonTitle(title: string, status = 200) {
  return async () => Response.json({ choices: [{ message: { content: title } }] }, { status })
}

function reasoningPart(overrides: Partial<TestPart> = {}): TestPart {
  return {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "reasoning",
    text: "Looking at the parser",
    time: { start: 1, end: 2 },
    ...overrides,
  }
}

function createApi(input: { parts: Map<string, TestPart[]>; kv?: Map<string, unknown> }) {
  const listeners: Array<(event: any) => void> = []
  const disposers: Array<() => void> = []
  const updates: UpdateCall[] = []
  let updateHandler: (call: UpdateCall) => Promise<any> = async (call) => ({ data: call.part, error: undefined })
  const kv = input.kv ?? new Map<string, unknown>()

  const api = {
    kv: {
      get: (key: string, fallback?: unknown) => (kv.has(key) ? kv.get(key) : fallback),
      set: (key: string, value: unknown) => void kv.set(key, value),
      ready: true,
    },
    state: {
      config: { small_model: "mock/small-model" },
      provider: [{ id: "mock", options: { baseURL: "http://mock.test/v1" } }],
      part: (messageID: string) => input.parts.get(messageID) ?? [],
    },
    event: {
      on: (_type: string, handler: (event: any) => void) => {
        listeners.push(handler)
        return () => {}
      },
    },
    client: {
      app: {
        log: async () => ({ data: undefined, error: undefined }),
      },
      part: {
        update: async (call: UpdateCall) => {
          updates.push(call)
          return await updateHandler(call)
        },
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: (fn: () => void) => {
        disposers.push(fn)
        return () => {}
      },
    },
  }

  return {
    api: api as unknown as TuiPluginApi,
    parts: input.parts,
    kv,
    updates,
    onUpdate: (handler: (call: UpdateCall) => Promise<any>) => {
      updateHandler = handler
    },
    emit(event: any) {
      for (const handler of [...listeners]) handler(event)
    },
    dispose() {
      for (const fn of [...disposers].reverse()) fn()
    },
  }
}

function partUpdated(part: TestPart) {
  return {
    type: "message.part.updated",
    properties: { sessionID: part.sessionID, part, time: Date.now() },
  }
}

async function waitFor(check: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(5)
  }
}

async function start(api: TuiPluginApi, options?: Record<string, unknown>) {
  const module = plugin as TuiPluginModule
  await module.tui(api, options, {} as TuiPluginMeta)
}

function setup() {
  fetchCalls = []
  respond = jsonTitle("Checking alignment")
  stubFetch()
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("async reasoning titles plugin", () => {
  test("generates and embeds a title for a completed untitled block", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => harness.updates.length === 1)

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe("http://mock.test/v1/chat/completions")
    expect(fetchCalls[0]?.body).toMatchObject({ model: "small-model", stream: false })
    expect(String(fetchCalls[0]?.body.messages?.[1]?.content)).toContain("Looking at the parser")

    expect(harness.updates[0]).toMatchObject({ sessionID: "ses_1", messageID: "msg_1", partID: "prt_1" })
    expect(harness.updates[0]?.part.text).toBe("**Checking alignment**\n\nLooking at the parser")
    expect(harness.updates[0]?.part.metadata).toEqual({ [TITLE_METADATA_KEY]: "Checking alignment" })
    harness.dispose()
  })

  test("skips short streaming, titled, expanded-mode, and title-mode blocks", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart({ time: { start: 1 } })))
    harness.emit(partUpdated(reasoningPart({ id: "prt_2", text: "**Existing title**\n\nBody" })))
    harness.emit(
      partUpdated(
        reasoningPart({ id: "prt_4", metadata: { anthropic: { signature: "signed" } } }),
      ),
    )
    harness.kv.set("thinking_mode", "show")
    harness.emit(partUpdated(reasoningPart({ id: "prt_3" })))
    await Bun.sleep(50)

    expect(fetchCalls).toHaveLength(0)
    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("deduplicates repeated updates for the same block", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    harness.emit(partUpdated(reasoningPart()))
    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => harness.updates.length === 1)

    expect(fetchCalls).toHaveLength(1)
    harness.dispose()
  })

  test("stays disabled when no model option is configured", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    await start(harness.api)

    harness.emit(partUpdated(reasoningPart()))
    await Bun.sleep(50)

    expect(fetchCalls).toHaveLength(0)
    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("titles a long block while it is still streaming", async () => {
    setup()
    const streamed = `${"x".repeat(40)}${"Z".repeat(20)}`
    const parts = new Map<string, TestPart[]>([
      ["msg_1", [reasoningPart({ text: streamed, time: { start: 1 } })]],
    ])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model", maxInputChars: 40 })

    harness.emit(partUpdated(reasoningPart({ text: streamed, time: { start: 1 } })))
    await waitFor(() => fetchCalls.length === 1)

    const prompt = String(fetchCalls[0]?.body.messages?.[1]?.content)
    expect(prompt).toContain("x".repeat(40))
    expect(prompt).not.toContain("Z")
    expect(harness.updates).toHaveLength(0)

    const grown = `${streamed} and more`
    const streaming = reasoningPart({ text: grown, time: { start: 1 } })
    parts.set("msg_1", [streaming])
    harness.emit(partUpdated(streaming))
    await Bun.sleep(30)
    expect(harness.updates).toHaveLength(0)

    const done = reasoningPart({ text: grown })
    parts.set("msg_1", [done])
    harness.emit(partUpdated(done))
    await waitFor(() => harness.updates.length === 1)

    expect(harness.updates[0]?.part.text).toBe(`**Checking alignment**\n\n${grown}`)
    harness.dispose()
  })

  test("waits for the min-chars floor before titling a streaming block", async () => {
    setup()
    const text = "x".repeat(50)
    const parts = new Map<string, TestPart[]>([
      ["msg_1", [reasoningPart({ text, time: { start: 1 } })]],
    ])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart({ text, time: { start: 1 } })))
    await Bun.sleep(30)
    expect(fetchCalls).toHaveLength(0)

    const done = reasoningPart({ text })
    parts.set("msg_1", [done])
    harness.emit(partUpdated(done))
    await waitFor(() => fetchCalls.length === 1)
    harness.dispose()
  })

  test("honors a custom minChars floor while streaming", async () => {
    setup()
    const text = "x".repeat(30)
    const parts = new Map<string, TestPart[]>([
      ["msg_1", [reasoningPart({ text, time: { start: 1 } })]],
    ])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model", minChars: 20 })

    harness.emit(partUpdated(reasoningPart({ text, time: { start: 1 } })))
    await waitFor(() => fetchCalls.length === 1)
    expect(harness.updates).toHaveLength(0)

    const done = reasoningPart({ text })
    parts.set("msg_1", [done])
    harness.emit(partUpdated(done))
    await waitFor(() => harness.updates.length === 1)
    expect(harness.updates[0]?.part.text).toBe(`**Checking alignment**\n\n${text}`)
    harness.dispose()
  })

  test("drops an early title when the block turns out to be signed", async () => {
    setup()
    const text = "x".repeat(60)
    const parts = new Map<string, TestPart[]>([
      ["msg_1", [reasoningPart({ text, time: { start: 1 } })]],
    ])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model", maxInputChars: 40 })

    harness.emit(partUpdated(reasoningPart({ text, time: { start: 1 } })))
    await waitFor(() => fetchCalls.length === 1)

    const signed = reasoningPart({ text, metadata: { anthropic: { signature: "signed" } } })
    parts.set("msg_1", [signed])
    harness.emit(partUpdated(signed))
    await Bun.sleep(30)

    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("does not retry a failed early generation while the block streams", async () => {
    setup()
    respond = async () => new Response("nope", { status: 500 })
    const text = "x".repeat(60)
    const parts = new Map<string, TestPart[]>([
      ["msg_1", [reasoningPart({ text, time: { start: 1 } })]],
    ])
    const harness = createApi({ parts })
    await start(harness.api, { model: "mock/small-model", maxInputChars: 40 })

    harness.emit(partUpdated(reasoningPart({ text, time: { start: 1 } })))
    await waitFor(() => fetchCalls.length === 1)
    await Bun.sleep(30)

    const grown = reasoningPart({ text: `${text}more`, time: { start: 1 } })
    parts.set("msg_1", [grown])
    harness.emit(partUpdated(grown))
    await Bun.sleep(30)

    expect(fetchCalls).toHaveLength(1)
    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("discards the result when the reasoning text changes during generation", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    let release: (() => void) | undefined
    respond = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ choices: [{ message: { content: "Checking alignment" } }] }))
      })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => fetchCalls.length === 1)
    parts.set("msg_1", [reasoningPart({ text: "Changed reasoning" })])
    release?.()
    await Bun.sleep(50)

    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("does not overwrite a provider title that arrives while generating", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    let release: (() => void) | undefined
    respond = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ choices: [{ message: { content: "Checking alignment" } }] }))
      })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => fetchCalls.length === 1)
    parts.set("msg_1", [reasoningPart({ text: "**Provider title**\n\nLooking at the parser" })])
    release?.()
    await Bun.sleep(50)

    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("does not recreate a part that was deleted while generating", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    let release: (() => void) | undefined
    respond = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ choices: [{ message: { content: "Checking alignment" } }] }))
      })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => fetchCalls.length === 1)
    parts.delete("msg_1")
    release?.()
    await Bun.sleep(50)

    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("keeps working after a summarizer failure", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    respond = async () => new Response("nope", { status: 500 })
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => fetchCalls.length === 1)
    await Bun.sleep(30)
    expect(harness.updates).toHaveLength(0)

    respond = jsonTitle("Retrying with a working model")
    const retry = reasoningPart({ id: "prt_2" })
    parts.set("msg_1", [reasoningPart(), retry])
    harness.emit(partUpdated(retry))
    await waitFor(() => harness.updates.length === 1)
    expect(harness.updates[0]?.part.text).toContain("**Retrying with a working model**")
    harness.dispose()
  })

  test("aborts in-flight generation when thinking mode switches to show", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    let aborted = false
    respond = (init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true
          reject(new Error("aborted"))
        })
      })
    await start(harness.api, { model: "mock/small-model", modePollMs: 20 })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => fetchCalls.length === 1)
    harness.kv.set("thinking_mode", "show")
    await waitFor(() => aborted)
    await Bun.sleep(30)

    expect(harness.updates).toHaveLength(0)
    harness.dispose()
  })

  test("reports apply failures without crashing", async () => {
    setup()
    const parts = new Map<string, TestPart[]>([["msg_1", [reasoningPart()]]])
    const harness = createApi({ parts })
    harness.onUpdate(async () => ({ data: undefined, error: { message: "bad request" } }))
    await start(harness.api, { model: "mock/small-model" })

    harness.emit(partUpdated(reasoningPart()))
    await waitFor(() => harness.updates.length === 1)
    await Bun.sleep(20)
    harness.dispose()
  })
})
