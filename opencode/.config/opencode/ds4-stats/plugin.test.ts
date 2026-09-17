import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message } from "@opencode-ai/sdk/v2"
import { createParser } from "./helpers"
import plugin from "../tui-plugins/ds4-stats"

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
