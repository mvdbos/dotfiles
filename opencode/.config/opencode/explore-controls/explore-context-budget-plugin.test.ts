import { describe, expect, test } from "bun:test"
import { FINAL_SUMMARY_INSTRUCTION } from "./context-budget"
import { ExploreContextBudgetPlugin } from "../plugins/explore-context-budget"

type PluginHooks = Awaited<ReturnType<typeof ExploreContextBudgetPlugin>>

async function hooks() {
  return ExploreContextBudgetPlugin({} as never)
}

async function markExplore(plugin: PluginHooks, sessionID: string) {
  await plugin["chat.message"]?.(
    { sessionID, agent: "explore" },
    { message: { agent: "explore" }, parts: [] } as never,
  )
}

async function setMessages(plugin: PluginHooks, sessionID: string, content: string) {
  await plugin["experimental.chat.messages.transform"]?.({}, {
    messages: [{ info: { sessionID, role: "user", agent: "explore" }, parts: [{ type: "text", text: content }] }],
  } as never)
}

async function transformSystem(
  plugin: PluginHooks,
  sessionID: string,
  system = ["base"],
  model: { id?: string; limit?: { context?: number; input?: number; output?: number } } = {
    id: "resolved",
    limit: { context: 100, output: 0 },
  },
) {
  await plugin["experimental.chat.system.transform"]?.({ sessionID, model } as never, { system } as never)
  return system
}

async function blockTool(plugin: PluginHooks, sessionID: string) {
  return plugin["tool.execute.before"]?.(
    { tool: "read", sessionID, callID: "tool-call" },
    { args: {} },
  )
}

describe("ExploreContextBudgetPlugin", () => {
  test("allows normal exploration below threshold", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "below")
    await setMessages(plugin, "below", "small")

    expect(await transformSystem(plugin, "below")).toEqual(["base"])
    await blockTool(plugin, "below")
  })

  test("marks exhaustion after a fresh tool result and injects one final instruction", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "crossing")
    await setMessages(plugin, "crossing", "small")
    expect(await transformSystem(plugin, "crossing")).toEqual(["base"])

    await setMessages(plugin, "crossing", "x".repeat(400))
    const system = await transformSystem(plugin, "crossing")
    expect(system).toHaveLength(2)
    expect(system[1]).toBe(FINAL_SUMMARY_INSTRUCTION)
    await expect(blockTool(plugin, "crossing")).rejects.toThrow("Do not call another tool")
  })

  test("keeps exhaustion sticky and does not duplicate the instruction", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "sticky")
    await setMessages(plugin, "sticky", "x".repeat(400))
    const system = await transformSystem(plugin, "sticky")
    const nextSystem = await transformSystem(plugin, "sticky", ["base"])

    expect(system.filter((item) => item === FINAL_SUMMARY_INSTRUCTION)).toHaveLength(1)
    expect(nextSystem.filter((item) => item === FINAL_SUMMARY_INSTRUCTION)).toHaveLength(1)
    await setMessages(plugin, "sticky", "small")
    await transformSystem(plugin, "sticky")
    await expect(blockTool(plugin, "sticky")).rejects.toThrow()
  })

  test("does not stop when the model context limit is unknown", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "unknown")
    await setMessages(plugin, "unknown", "x".repeat(10_000))

    expect(await transformSystem(plugin, "unknown", ["base"], { id: "unknown", limit: {} })).toEqual(["base"])
    await blockTool(plugin, "unknown")
  })

  test("uses the resolved model and effective output allowance", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "model")
    await setMessages(plugin, "model", "x".repeat(100))
    await plugin["chat.params"]?.(
      { sessionID: "model", agent: "explore" } as never,
      { maxOutputTokens: 10 } as never,
    )

    expect(await transformSystem(plugin, "model", ["base"], { id: "resolved-small", limit: { context: 1_000, output: 100 } })).toEqual([
      "base",
    ])
  })

  test("does not affect parent or unrelated agent sessions", async () => {
    const plugin = await hooks()
    await plugin["chat.message"]?.(
      { sessionID: "parent", agent: "build" },
      { message: { agent: "build" }, parts: [] } as never,
    )
    await plugin["experimental.chat.messages.transform"]?.({}, {
      messages: [{ info: { sessionID: "parent", role: "user", agent: "build" }, parts: [{ type: "text", text: "x".repeat(10_000) }] }],
    } as never)

    expect(await transformSystem(plugin, "parent", ["base"], { id: "parent-model", limit: { context: 100, output: 0 } })).toEqual([
      "base",
    ])
    await plugin["tool.execute.before"]?.(
      { tool: "read", sessionID: "parent", callID: "parent-tool" },
      { args: {} },
    )
  })

  test("cleans up after success, failure, cancellation, and deletion", async () => {
    const plugin = await hooks()
    for (const [sessionID, event] of [
      ["success", { type: "session.idle", properties: { sessionID: "success" } }],
      ["failure", { type: "session.error", properties: { sessionID: "failure" } }],
      ["cancel", { type: "session.error", properties: { sessionID: "cancel", error: { name: "MessageAbortedError" } } }],
      ["deleted", { type: "session.deleted", properties: { info: { id: "deleted" } } }],
    ] as const) {
      await markExplore(plugin, sessionID)
      await setMessages(plugin, sessionID, "x".repeat(400))
      await transformSystem(plugin, sessionID)
      await plugin.event?.({ event } as never)
      await blockTool(plugin, sessionID)
    }
  })

  test("keeps exhaustion across compaction and until final-summary completion", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "compaction")
    await setMessages(plugin, "compaction", "x".repeat(400))
    await transformSystem(plugin, "compaction")
    await plugin.event?.({ event: { type: "session.compacted", properties: { sessionID: "compaction" } } } as never)

    await expect(blockTool(plugin, "compaction")).rejects.toThrow()
    await plugin.event?.({ event: { type: "session.idle", properties: { sessionID: "compaction" } } } as never)
    await blockTool(plugin, "compaction")
  })

  test("re-evaluates retained history when a resumed exploration starts", async () => {
    const plugin = await hooks()
    await markExplore(plugin, "resumed")
    await setMessages(plugin, "resumed", "small")
    await transformSystem(plugin, "resumed")
    await plugin.event?.({ event: { type: "session.idle", properties: { sessionID: "resumed" } } } as never)

    await markExplore(plugin, "resumed")
    await setMessages(plugin, "resumed", "x".repeat(400))
    const system = await transformSystem(plugin, "resumed")
    expect(system).toContain(FINAL_SUMMARY_INSTRUCTION)
    await expect(blockTool(plugin, "resumed")).rejects.toThrow()
  })
})
