import { afterEach, describe, expect, test } from "bun:test"
import {
  ExploreAdmissionCancelledError,
  ExploreAdmissionQueue,
  ExploreAdmissionTimeoutError,
} from "./concurrency-queue"
import { ExploreConcurrencyPlugin } from "../plugins/explore-concurrency"

const originalPath = process.env.OPENCODE_EXPLORE_QUEUE_PATH
let currentPath: string | undefined

afterEach(() => {
  if (originalPath === undefined) delete process.env.OPENCODE_EXPLORE_QUEUE_PATH
  else process.env.OPENCODE_EXPLORE_QUEUE_PATH = originalPath
  currentPath = undefined
})

async function hooks() {
  currentPath ??= `/tmp/opencode-explore-plugin-${crypto.randomUUID()}.sqlite`
  process.env.OPENCODE_EXPLORE_QUEUE_PATH = currentPath
  return ExploreConcurrencyPlugin({ client: {} } as never)
}

async function beforeTask(plugin: Awaited<ReturnType<typeof ExploreConcurrencyPlugin>>, sessionID: string, callID: string, args = {}) {
  await plugin["tool.execute.before"]?.(
    { tool: "task", sessionID, callID },
    { args: { subagent_type: "explore", ...args } },
  )
}

async function afterTask(
  plugin: Awaited<ReturnType<typeof ExploreConcurrencyPlugin>>,
  sessionID: string,
  callID: string,
  metadata: Record<string, unknown>,
) {
  await plugin["tool.execute.after"]?.(
    { tool: "task", sessionID, callID, args: {} },
    { title: "task", output: "", metadata },
  )
}

function childIdle(plugin: Awaited<ReturnType<typeof ExploreConcurrencyPlugin>>, sessionID: string) {
  return plugin.event?.({ event: { type: "session.idle", properties: { sessionID } } } as never)
}

async function slotAvailable() {
  const observer = new ExploreAdmissionQueue({
    path: currentPath,
    timeoutMs: 30,
    pollMs: 2,
    process: { pid: process.pid + 1, start: "observer" },
    isProcessAlive: () => true,
  })
  try {
    const lease = await observer.acquire()
    lease.release()
    return true
  } catch (error) {
    if (error instanceof ExploreAdmissionTimeoutError) return false
    throw error
  } finally {
    observer.close()
  }
}

async function dispose(plugin: Awaited<ReturnType<typeof ExploreConcurrencyPlugin>>) {
  await (plugin as typeof plugin & { dispose?: () => Promise<void> }).dispose?.()
}

describe("ExploreConcurrencyPlugin", () => {
  test("guards only explore Task calls and works without the context plugin", async () => {
    const plugin = await hooks()
    let ordinaryCompleted = false
    await plugin["tool.execute.before"]?.(
      { tool: "task", sessionID: "parent", callID: "ordinary" },
      { args: { subagent_type: "build" } },
    )
    ordinaryCompleted = true

    expect(ordinaryCompleted).toBe(true)
    await beforeTask(plugin, "parent", "explore")
    await afterTask(plugin, "parent", "explore", { sessionId: "child" })
  })

  test("holds a foreground slot until the Task terminal path", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a")
    let started = false
    const waiting = beforeTask(second, "parent-b", "call-b").then(() => {
      started = true
    })

    await Bun.sleep(10)
    expect(started).toBe(false)
    await afterTask(first, "parent-a", "call-a", { sessionId: "child-a" })
    await waiting
    expect(started).toBe(true)
    await afterTask(second, "parent-b", "call-b", { sessionId: "child-b" })
  })

  test("releases after a background child reaches idle", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a")
    await afterTask(first, "parent-a", "call-a", { sessionId: "child-a", background: true })
    let started = false
    const waiting = beforeTask(second, "parent-b", "call-b").then(() => {
      started = true
    })

    await Bun.sleep(10)
    expect(started).toBe(false)
    await childIdle(first, "child-a")
    await waiting
    expect(started).toBe(true)
    await afterTask(second, "parent-b", "call-b", { sessionId: "child-b" })
  })

  test("releases a reservation when the parent Task fails before child creation", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a")
    const waiting = beforeTask(second, "parent-b", "call-b")
    await Bun.sleep(10)
    await first.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "task",
            sessionID: "parent-a",
            callID: "call-a",
            state: { status: "error" },
          },
        },
      },
    } as never)
    await waiting
    await afterTask(second, "parent-b", "call-b", { sessionId: "child-b" })
  })

  test("releases a background reservation when the Task fails before child creation", async () => {
    const plugin = await hooks()
    try {
      await beforeTask(plugin, "parent", "call", { background: true })
      await plugin.event?.({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              type: "tool",
              tool: "task",
              sessionID: "parent",
              callID: "call",
              state: { status: "error" },
            },
          },
        },
      } as never)

      expect(await slotAvailable()).toBe(true)
    } finally {
      await dispose(plugin)
    }
  })

  test("cancels a queued parent and removes its admission wait", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a")
    const waiting = beforeTask(second, "parent-b", "call-b")
    await Bun.sleep(10)
    await second.event?.({ event: { type: "session.deleted", properties: { info: { id: "parent-b" } } } } as never)

    await expect(waiting).rejects.toBeInstanceOf(ExploreAdmissionCancelledError)
    await afterTask(first, "parent-a", "call-a", { sessionId: "child-a" })
  })

  test("releases a background child after model failure and tolerates duplicate terminal events", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a")
    await afterTask(first, "parent-a", "call-a", { sessionId: "child-a", background: true })
    const waiting = beforeTask(second, "parent-b", "call-b")
    await Bun.sleep(10)
    const error = { type: "session.error", properties: { sessionID: "child-a" } }
    await first.event?.({ event: error } as never)
    await first.event?.({ event: error } as never)
    await waiting
    await afterTask(second, "parent-b", "call-b", { sessionId: "child-b" })
  })

  test("handles a background child that finishes before the task after-hook", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a", { background: true })
    await first.event?.({
      event: {
        type: "session.created",
        properties: { info: { id: "child-a", parentID: "parent-a" } },
      },
    } as never)
    const waiting = beforeTask(second, "parent-b", "call-b")
    await Bun.sleep(10)
    await childIdle(first, "child-a")
    await waiting
    await afterTask(first, "parent-a", "call-a", { sessionId: "child-a", background: true })
    await afterTask(second, "parent-b", "call-b", { sessionId: "child-b" })
  })

  test("ignores unrelated child agents", async () => {
    const plugin = await hooks()
    try {
      await beforeTask(plugin, "parent", "call", { background: true })
      await plugin.event?.({
        event: {
          type: "session.created",
          properties: { info: { id: "explore-child", parentID: "parent", agent: "explore" } },
        },
      } as never)
      await plugin.event?.({
        event: {
          type: "session.created",
          properties: { info: { id: "build-child", parentID: "parent", agent: "build" } },
        },
      } as never)
      await childIdle(plugin, "build-child")

      expect(await slotAvailable()).toBe(false)
      await childIdle(plugin, "explore-child")
      expect(await slotAvailable()).toBe(true)
    } finally {
      await dispose(plugin)
    }
  })

  test("does not replace an established child association", async () => {
    const plugin = await hooks()
    try {
      await beforeTask(plugin, "parent", "call", { background: true })
      await plugin.event?.({
        event: {
          type: "session.created",
          properties: { info: { id: "first-child", parentID: "parent", agent: "explore" } },
        },
      } as never)
      await plugin.event?.({
        event: {
          type: "session.created",
          properties: { info: { id: "replacement-child", parentID: "parent", agent: "explore" } },
        },
      } as never)
      await childIdle(plugin, "replacement-child")

      expect(await slotAvailable()).toBe(false)
      await childIdle(plugin, "first-child")
      expect(await slotAvailable()).toBe(true)
    } finally {
      await dispose(plugin)
    }
  })

  test("does not acquire a second slot for a resumed child session", async () => {
    const plugin = await hooks()
    await beforeTask(plugin, "parent", "call", { task_id: "existing-child" })

    await plugin["chat.message"]?.(
      { sessionID: "existing-child", agent: "explore" },
      { message: { agent: "explore" }, parts: [] } as never,
    )
    await afterTask(plugin, "parent", "call", { sessionId: "existing-child" })
  })

  test("guards direct explore sessions and releases them at session idle", async () => {
    const first = await hooks()
    const second = await hooks()
    await first["chat.message"]?.(
      { sessionID: "direct-a", agent: "explore" },
      { message: { agent: "explore" }, parts: [] } as never,
    )
    let started = false
    const waiting = second["chat.message"]?.(
      { sessionID: "direct-b", agent: "explore" },
      { message: { agent: "explore" }, parts: [] } as never,
    ).then(() => {
      started = true
    })

    await Bun.sleep(10)
    expect(started).toBe(false)
    await childIdle(first, "direct-a")
    await waiting
    expect(started).toBe(true)
    await childIdle(second, "direct-b")
  })

  test("recovers a held slot on parent deletion", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "parent-a", "call-a")
    const waiting = beforeTask(second, "parent-b", "call-b")
    await Bun.sleep(10)
    await first.event?.({ event: { type: "session.deleted", properties: { info: { id: "parent-a" } } } } as never)
    await waiting
    await afterTask(second, "parent-b", "call-b", { sessionId: "child-b" })
  })
})
