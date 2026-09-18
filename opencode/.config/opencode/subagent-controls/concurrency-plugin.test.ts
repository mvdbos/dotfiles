/// <reference path="../explore-controls/bun-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { SubagentConcurrencyPlugin } from "../plugins/subagent-concurrency"

const originalPath = process.env.OPENCODE_SUBAGENT_QUEUE_PATH

afterEach(() => {
  if (originalPath === undefined) delete process.env.OPENCODE_SUBAGENT_QUEUE_PATH
  else process.env.OPENCODE_SUBAGENT_QUEUE_PATH = originalPath
})

async function hooks() {
  process.env.OPENCODE_SUBAGENT_QUEUE_PATH ??= `/tmp/opencode-subagent-plugin-${crypto.randomUUID()}.sqlite`
  return SubagentConcurrencyPlugin({ client: {} } as never)
}

async function beforeTask(
  plugin: Awaited<ReturnType<typeof SubagentConcurrencyPlugin>>,
  agent: string,
  callID: string,
) {
  await plugin["tool.execute.before"]?.(
    { tool: "task", sessionID: "parent", callID },
    { args: { subagent_type: agent } },
  )
}

async function afterTask(
  plugin: Awaited<ReturnType<typeof SubagentConcurrencyPlugin>>,
  callID: string,
  childID: string,
) {
  await plugin["tool.execute.after"]?.(
    { tool: "task", sessionID: "parent", callID, args: {} },
    { title: "task", output: "", metadata: { sessionId: childID } },
  )
}

describe("SubagentConcurrencyPlugin", () => {
  test("serializes the same agent while admitting another controlled agent", async () => {
    const first = await hooks()
    const second = await hooks()
    await beforeTask(first, "explore", "explore-a")

    let secondExploreStarted = false
    const waiting = beforeTask(second, "explore", "explore-b").then(() => {
      secondExploreStarted = true
    })
    await beforeTask(second, "general", "general-a")

    expect(secondExploreStarted).toBe(false)
    await afterTask(second, "general-a", "general-child")
    await afterTask(first, "explore-a", "explore-child")
    await waiting
    expect(secondExploreStarted).toBe(true)
    await afterTask(second, "explore-b", "second-explore-child")
  })

  test("correlates parallel children by parent and agent", async () => {
    const owner = await hooks()
    const waiter = await hooks()
    await owner["tool.execute.before"]?.(
      { tool: "task", sessionID: "shared-parent", callID: "explore-call" },
      { args: { subagent_type: "explore", background: true } },
    )
    await owner["tool.execute.before"]?.(
      { tool: "task", sessionID: "shared-parent", callID: "general-call" },
      { args: { subagent_type: "general", background: true } },
    )
    await owner.event?.({
      event: {
        type: "session.created",
        properties: { info: { id: "explore-child", parentID: "shared-parent", agent: "explore" } },
      },
    } as never)
    await owner.event?.({
      event: {
        type: "session.created",
        properties: { info: { id: "general-child", parentID: "shared-parent", agent: "general" } },
      },
    } as never)
    await owner["tool.execute.after"]?.(
      { tool: "task", sessionID: "shared-parent", callID: "explore-call", args: {} },
      { title: "task", output: "", metadata: { sessionId: "explore-child", background: true } },
    )
    await owner["tool.execute.after"]?.(
      { tool: "task", sessionID: "shared-parent", callID: "general-call", args: {} },
      { title: "task", output: "", metadata: { sessionId: "general-child", background: true } },
    )

    await owner.event?.({ event: { type: "session.idle", properties: { sessionID: "explore-child" } } } as never)
    await beforeTask(waiter, "explore", "next-explore")
    let generalStarted = false
    const generalWaiting = beforeTask(waiter, "general", "next-general").then(() => {
      generalStarted = true
    })
    await Bun.sleep(10)
    expect(generalStarted).toBe(false)

    await owner.event?.({ event: { type: "session.idle", properties: { sessionID: "general-child" } } } as never)
    await generalWaiting
    expect(generalStarted).toBe(true)
    await afterTask(waiter, "next-explore", "next-explore-child")
    await afterTask(waiter, "next-general", "next-general-child")
  })
})
