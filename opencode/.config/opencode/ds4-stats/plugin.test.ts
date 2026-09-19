import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message } from "@opencode-ai/sdk/v2"
import { createParser, usageMessages } from "./helpers"
import plugin, { fetchAllMessages } from "../tui-plugins/ds4-stats"

const FIXTURE = [
  "chat ctx=0..100:100 prompt start",
  "chat ctx=0..100:100 prompt done 2.0s",
  "chat ctx=100..120:20 gen=20 decoding chunk=25.00 t/s avg=25.00 t/s 0.8s",
  "chat ctx=0..100:100 gen=20 finish=stop 2.9s",
].join("\n")

type Registered = { slots: Record<string, unknown> }

function stubApi(registered: Registered[], messages: Message[]): TuiPluginApi {
  const theme = {
    current: {
      success: "#50fa7b",
      warning: "#f1fa8c",
      error: "#ff5555",
      textMuted: "#6272a4",
    },
  }
  return {
    theme,
    state: { session: { messages: () => messages } },
    event: { on: () => () => {} },
    slots: {
      register: (value: Registered) => {
        registered.push(value)
        return "ds4-stats"
      },
    },
    lifecycle: { onDispose: () => () => {} },
  } as unknown as TuiPluginApi
}

describe("ds4-stats tui plugin", () => {
  test("registers a sidebar_content slot and tails a pinned log", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "ds4-stats-"))
    const log = path.join(home, "ds4-server.log")
    await writeFile(log, FIXTURE + "\n")

    const registered: Registered[] = []
    const api = stubApi(registered, [])
    try {
      await plugin.tui(api, { log, pollMs: 100 }, {} as never)

      expect(registered).toHaveLength(1)
      expect(typeof registered[0].slots.sidebar_content).toBe("function")
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test("stays quiet when the log does not exist", async () => {
    const registered: Registered[] = []
    const api = stubApi(registered, [])
    await plugin.tui(api, { log: "/nonexistent/ds4-server.log", pollMs: 100 }, {} as never)
    expect(registered).toHaveLength(1)
  })
})

describe("fixture sanity", () => {
  test("parses the fixture the plugin consumes", () => {
    const parser = createParser()
    for (const line of FIXTURE.split("\n")) parser.push(line)
    expect(parser.requests).toHaveLength(1)
    expect(parser.requests[0].total).toBe(100)
  })
})

function fakeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) =>
    ({
      id: `msg_${String(index).padStart(4, "0")}`,
      sessionID: "ses_test",
      role: "assistant",
      parentID: "msg_user",
      modelID: "qwen3.8-flash-next",
      providerID: "ds4",
      mode: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      time: { created: index + 1 },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    }) as unknown as Message,
  )
}

// Mirrors GET /session/:sessionID/message: newest-first pages of `limit`, the
// next-page cursor in the X-Next-Cursor header, each page returned ascending.
function pagingClient(all: Message[], partsFor?: (message: Message) => unknown[]) {
  const calls: Array<{ limit?: number; before?: string }> = []
  const encode = (message: Message) =>
    Buffer.from(JSON.stringify({ id: message.id, time: message.time.created })).toString("base64url")
  return {
    calls,
    client: {
      session: {
        messages: async (options: { sessionID: string; limit?: number; before?: string }) => {
          calls.push({ limit: options.limit, before: options.before })
          const limit = options.limit ?? 0
          const before = options.before
            ? (JSON.parse(Buffer.from(options.before, "base64url").toString("utf8")) as { id: string; time: number })
            : undefined
          const ordered = [...all].sort(
            (a, b) => b.time.created - a.time.created || (a.id > b.id ? -1 : a.id < b.id ? 1 : 0),
          )
          const eligible = before
            ? ordered.filter(
                (message) =>
                  message.time.created < before.time ||
                  (message.time.created === before.time && message.id < before.id),
              )
            : ordered
          const slice = limit > 0 ? eligible.slice(0, limit) : eligible
          const more = limit > 0 && eligible.length > limit
          const items = [...slice].reverse().map((info) => ({ info, parts: partsFor?.(info) ?? [] }))
          const tail = slice.at(-1)
          const next = more && tail ? encode(tail) : undefined
          return {
            data: items,
            error: undefined,
            request: new Request("http://localhost/session/ses_test/message"),
            response: new Response("null", { headers: next ? { "x-next-cursor": next } : undefined }),
          }
        },
      },
    },
  }
}

describe("fetchAllMessages", () => {
  test("pages past the TUI store's 100-message window", async () => {
    const fake = pagingClient(fakeMessages(150))
    const fetched = await fetchAllMessages(fake.client as never, "ses_test")

    expect(fake.calls.length).toBeGreaterThan(1)
    expect(fake.calls.every((call) => call.limit !== undefined)).toBe(true)
    expect(fetched.messages).toHaveLength(150)
    expect(fetched.messages[0]?.id).toBe("msg_0000")
    expect(fetched.messages[149]?.id).toBe("msg_0149")
    expect(fetched.parts).toEqual([])
    expect(usageMessages(fetched.messages, ["ds4"])).toHaveLength(150)
  })

  test("keeps finalized tool spans and skips unfinished or non-tool parts", async () => {
    const fake = pagingClient(fakeMessages(2), (message) =>
      message.id === "msg_0000"
        ? [
            {
              id: "prt_done",
              messageID: message.id,
              type: "tool",
              tool: "bash",
              state: { status: "completed", time: { start: 1000, end: 4000 } },
            },
            {
              id: "prt_err",
              messageID: message.id,
              type: "tool",
              tool: "read",
              state: { status: "error", time: { start: 4000, end: 9000 } },
            },
            {
              id: "prt_ask",
              messageID: message.id,
              type: "tool",
              tool: "question",
              state: { status: "completed", time: { start: 9000, end: 90_000 } },
            },
            {
              id: "prt_run",
              messageID: message.id,
              type: "tool",
              tool: "bash",
              state: { status: "running", time: { start: 9000 } },
            },
            { id: "prt_text", messageID: message.id, type: "text", text: "hi" },
          ]
        : [],
    )
    const fetched = await fetchAllMessages(fake.client as never, "ses_test")

    expect(fetched.parts).toEqual([
      { id: "prt_done", messageID: "msg_0000", tool: "bash", start: 1000, end: 4000 },
      { id: "prt_err", messageID: "msg_0000", tool: "read", start: 4000, end: 9000 },
      { id: "prt_ask", messageID: "msg_0000", tool: "question", start: 9000, end: 90_000 },
    ])
  })
})
