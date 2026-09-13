/// <reference path="./bun-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { ExploreContextBudgetPlugin } from "../plugins/explore-context-budget"
import { ExploreConcurrencyPlugin } from "../plugins/explore-concurrency"
import { RtkOpenCodePlugin } from "../plugins/rtk"

type HookSet = Awaited<ReturnType<typeof ExploreConcurrencyPlugin>>
type ContextHooks = Awaited<ReturnType<typeof ExploreContextBudgetPlugin>>

const originalPath = process.env.OPENCODE_EXPLORE_QUEUE_PATH

afterEach(() => {
  if (originalPath === undefined) delete process.env.OPENCODE_EXPLORE_QUEUE_PATH
  else process.env.OPENCODE_EXPLORE_QUEUE_PATH = originalPath
})

async function load(order: "concurrency-first" | "context-first") {
  process.env.OPENCODE_EXPLORE_QUEUE_PATH = `/tmp/opencode-explore-combined-${crypto.randomUUID()}.sqlite`
  const concurrency = await ExploreConcurrencyPlugin({ client: {} } as never)
  const context = await ExploreContextBudgetPlugin({} as never)
  return order === "concurrency-first" ? [concurrency, context] : [context, concurrency]
}

async function runHooks<T extends HookSet | ContextHooks>(plugins: T[], name: keyof HookSet, input: unknown, output: unknown) {
  for (const plugin of plugins) {
    const hook = plugin[name]
    if (typeof hook === "function") await (hook as (input: unknown, output: unknown) => Promise<void>)(input, output)
  }
}

describe("combined explore plugins", () => {
  for (const order of ["concurrency-first", "context-first"] as const) {
    test(`works in ${order} load order and holds the slot through final summary`, async () => {
      const plugins = await load(order)
      const sessionID = `child-${order}`
      const parentID = `parent-${order}`
      const taskInput = { tool: "task", sessionID: parentID, callID: "task-call" }
      const taskOutput = { args: { subagent_type: "explore" } }

      await runHooks(plugins, "tool.execute.before", taskInput, taskOutput)
      await runHooks(plugins, "event", {
        event: {
          type: "session.created",
          properties: { info: { id: sessionID, parentID } },
        },
      }, undefined)
      await runHooks(plugins, "chat.message", { sessionID, agent: "explore" }, {
        message: { agent: "explore" },
        parts: [],
      })
      await runHooks(plugins, "experimental.chat.messages.transform", {}, {
        messages: [{
          info: { sessionID, role: "user", agent: "explore" },
          parts: [{ type: "text", text: "x".repeat(400) }],
        }],
      })

      const firstSystem = ["base"]
      await runHooks(plugins, "experimental.chat.system.transform", {
        sessionID,
        model: { id: "resolved", limit: { context: 100, output: 0 } },
      }, { system: firstSystem })
      expect(firstSystem.join("\n")).toContain("EXPLORATION CONTEXT BUDGET REACHED")

      const secondTask = ExploreConcurrencyPlugin({ client: {} } as never)
      let secondStarted = false
      const waiting = secondTask.then(async (plugin) => {
        await plugin["tool.execute.before"]?.(
          { tool: "task", sessionID: "other-parent", callID: "other-call" },
          { args: { subagent_type: "explore" } },
        )
        secondStarted = true
      })
      await Bun.sleep(10)
      expect(secondStarted).toBe(false)

      await expect(runHooks(plugins, "tool.execute.before", {
        tool: "read",
        sessionID,
        callID: "blocked-tool",
      }, { args: {} })).rejects.toThrow("Do not call another tool")
      expect(secondStarted).toBe(false)

      await runHooks(plugins, "event", { event: { type: "session.idle", properties: { sessionID } } }, undefined)
      await runHooks(plugins, "tool.execute.after", taskInput, {
        title: "task",
        output: "summary",
        metadata: { sessionId: sessionID },
      })
      await waiting
      expect(secondStarted).toBe(true)
      const secondPlugin = await secondTask
      await secondPlugin["tool.execute.after"]?.(
        { tool: "task", sessionID: "other-parent", callID: "other-call", args: {} },
        { title: "task", output: "", metadata: { sessionId: "other-child" } },
      )
    })
  }

  test("loads alongside RTK without changing its hook", async () => {
    const shell = (() => ({ quiet: () => Promise.reject(new Error("rtk not installed in test")) })) as never
    const rtk = await RtkOpenCodePlugin({ $: shell } as never)
    expect(rtk["tool.execute.before"]).toBeUndefined()
    await ExploreConcurrencyPlugin({ client: {} } as never)
    await ExploreContextBudgetPlugin({} as never)
  })
})
