import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk"
import {
  createTodoReconcileHooks,
  findCompactionBoundary,
  findNativeTodoCoverage,
  hasReminderPart,
  readTodosThroughClient,
  type LifecycleDeps,
  type MessageWithParts,
  type PersistSnapshotInput,
  type TodoItem,
  type TodoResponse,
} from "../src/lifecycle"
import { formatTodoReminder } from "../src/reminder"
import {
  canonicalTodoFingerprint,
  makeSnapshotPart,
  snapshotMetadata,
  snapshotPartID,
} from "../src/snapshot"

const todos: TodoItem[] = [
  { content: "Investigate crash", status: "in_progress", priority: "high" },
  { content: "Update README", status: "completed", priority: "low" },
]

type MessageOptions = {
  sessionID?: string
  parentID?: string
  finish?: string
  summary?: boolean
  error?: unknown
  tools?: Record<string, boolean>
}

function user(id: string, created: number, parts: Part[] = [], options: MessageOptions = {}): MessageWithParts {
  return {
    info: {
      id,
      sessionID: options.sessionID ?? "s1",
      role: "user",
      time: { created },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      ...(options.tools ? { tools: options.tools } : {}),
    },
    parts,
  } as unknown as MessageWithParts
}

function assistant(id: string, created: number, options: MessageOptions = {}, parts: Part[] = []): MessageWithParts {
  return {
    info: {
      id,
      sessionID: options.sessionID ?? "s1",
      role: "assistant",
      parentID: options.parentID ?? "u0",
      time: { created },
      modelID: "test",
      providerID: "test",
      mode: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      ...(options.finish ? { finish: options.finish } : {}),
      ...(options.summary !== undefined ? { summary: options.summary } : {}),
      ...(options.error ? { error: options.error } : {}),
    },
    parts,
  } as unknown as MessageWithParts
}

function compaction(sessionID = "s1"): Part {
  return {
    id: `p-compaction-${sessionID}`,
    sessionID,
    messageID: "u1",
    type: "compaction",
    auto: false,
  } as unknown as Part
}

function textPart(id: string, text: string, sessionID = "s1", messageID = "u2"): Part {
  return { id, sessionID, messageID, type: "text", text } as Part
}

function boundaryFixture(options: { sessionID?: string } = {}): MessageWithParts[] {
  const sessionID = options.sessionID ?? "s1"
  const u1 = user("u1", 10, [compaction(sessionID)], { sessionID })
  const a1 = assistant("a1", 11, { parentID: "u1", finish: "stop", summary: true, sessionID })
  const u2 = user("u2", 20, [textPart("p-text", "continue", sessionID)], { sessionID })
  return [u1, a1, u2]
}

function snapshotPart(
  boundaryID: string,
  messageID: string,
  values = todos,
  text = formatTodoReminder(values)!.text,
): Part {
  const projection = formatTodoReminder(values)!
  const fingerprint = canonicalTodoFingerprint(values)
  const metadata = snapshotMetadata({
    boundaryID,
    fingerprint,
    projection,
    originatingContinuationID: messageID,
  })
  return makeSnapshotPart({
    sessionID: "s1",
    messageID,
    partID: snapshotPartID({ sessionID: "s1", messageID, boundaryID, fingerprint }),
    text,
    metadata,
  })
}

function toolPart(input: { id: string; messageID: string; todos: TodoItem[]; failed?: boolean; compacted?: boolean }): Part {
  if (input.failed) {
    return {
      id: input.id,
      sessionID: "s1",
      messageID: input.messageID,
      type: "tool",
      callID: `call-${input.id}`,
      tool: "todowrite",
      state: {
        status: "error",
        input: { todos: input.todos },
        error: "failed",
        time: { start: 1, end: 2 },
      },
    } as unknown as Part
  }
  return {
    id: input.id,
    sessionID: "s1",
    messageID: input.messageID,
    type: "tool",
    callID: `call-${input.id}`,
    tool: "todowrite",
    state: {
      status: "completed",
      input: { todos: input.todos },
      output: "todos written",
      title: "todowrite",
      metadata: {},
      time: { start: 1, end: 2, ...(input.compacted ? { compacted: 3 } : {}) },
    },
  } as unknown as Part
}

function fakeDeps(
  read: LifecycleDeps["readTodos"],
  store?: (input: PersistSnapshotInput) => ReturnType<NonNullable<LifecycleDeps["persistSnapshot"]>>,
): { deps: LifecycleDeps; reads: string[]; writes: PersistSnapshotInput[] } {
  const reads: string[] = []
  const writes: PersistSnapshotInput[] = []
  const deps: LifecycleDeps = {
    readTodos: async (sessionID) => {
      reads.push(sessionID)
      return read(sessionID)
    },
    persistSnapshot: async (input) => {
      writes.push(input)
      if (store) return store(input)
      return {
        ok: true,
        durable: true,
        part: makeSnapshotPart({
          sessionID: input.sessionID,
          messageID: input.target.info.id,
          partID: input.partID,
          text: input.text,
          metadata: input.metadata,
        }),
      }
    },
  }
  return { deps, reads, writes }
}

async function transformWith(deps: LifecycleDeps, messages: MessageWithParts[]) {
  const hooks = createTodoReconcileHooks(deps)
  await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
  return hooks
}

describe("findCompactionBoundary", () => {
  test("finds a completed compaction pair", () => {
    const boundary = findCompactionBoundary(boundaryFixture())
    expect(boundary?.summary.id).toBe("a1")
    expect(boundary?.parent.info.id).toBe("u1")
  })

  test("ignores failed compaction summaries", () => {
    const messages = boundaryFixture()
    const summary = messages[1]!.info
    if (summary.role !== "assistant") throw new Error("unreachable")
    summary.error = { name: "APIError" } as never
    expect(findCompactionBoundary(messages)).toBeUndefined()
  })

  test("picks the latest boundary by time, not array position", () => {
    const messages = [
      ...boundaryFixture(),
      user("u4", 40, [compaction()]),
      assistant("a4", 41, { parentID: "u4", finish: "stop", summary: true }),
      user("u5", 50, [textPart("p-new", "new prompt")]),
    ]
    expect(findCompactionBoundary(messages)?.summary.id).toBe("a4")
  })
})

describe("native coverage", () => {
  test("recognizes only completed, unpruned full todo writes", () => {
    const messages = boundaryFixture()
    messages.push(
      assistant("a2", 30, { parentID: "u2", finish: "tool-calls" }, [
        toolPart({ id: "tool-ok", messageID: "a2", todos }),
      ]),
    )
    const boundary = findCompactionBoundary(messages)!
    expect(findNativeTodoCoverage(messages, boundary)?.todos).toEqual(todos)

    messages.push(
      assistant("a3", 31, { parentID: "u2", finish: "tool-calls" }, [
        toolPart({ id: "tool-pruned", messageID: "a3", todos, compacted: true }),
      ]),
    )
    expect(findNativeTodoCoverage(messages, boundary)?.key.id).toBe("a2")
  })
})

describe("createTodoReconcileHooks", () => {
  test("persists and injects one snapshot into the resumed request", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    await transformWith(deps, messages)

    const target = messages[2]!
    expect(reads).toEqual(["s1"])
    expect(writes).toHaveLength(1)
    expect(target.parts).toHaveLength(2)
    const part = target.parts[1]!
    expect(part.type).toBe("text")
    if (part.type !== "text") throw new Error("unreachable")
    expect(part.synthetic).toBe(true)
    expect(part.metadata?.["todo-reconcile"]).toBe(true)
    expect(part.metadata?.schemaVersion).toBe(1)
    expect(part.metadata?.boundaryID).toBe("a1")
  })

  test("does not restore without a successful boundary and strips summarizer snapshots", async () => {
    const { deps, reads } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = [user("u0", 1, [snapshotPart("old", "u0")])]
    await transformWith(deps, messages)
    expect(reads).toEqual([])
    expect(hasReminderPart(messages[0]!)).toBe(false)
  })

  test("does not use terminal completion as proof that memory was delivered", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    messages.push(assistant("a2", 30, { parentID: "u2", finish: "stop" }))
    await transformWith(deps, messages)
    expect(reads).toEqual(["s1"])
    expect(writes).toHaveLength(1)
  })

  test("reuses durable coverage across repeated transforms without rereading", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1"])
    expect(writes).toHaveLength(1)
  })

  test("keeps retry eligibility after a failed read and a successful answer", async () => {
    let attempt = 0
    const { deps, reads, writes } = fakeDeps(async () => {
      attempt++
      return attempt === 1 ? { ok: false, reason: "offline" } : { ok: true, todos }
    })
    const messages = boundaryFixture()
    await transformWith(deps, messages)
    messages.push(assistant("a2", 30, { parentID: "u2", finish: "stop" }))
    await transformWith(deps, messages)
    expect(reads).toEqual(["s1", "s1"])
    expect(writes).toHaveLength(1)
  })

  test("does not create false durable coverage when persistence fails", async () => {
    let attempt = 0
    const { deps, reads, writes } = fakeDeps(
      async () => ({ ok: true, todos }),
      async (input) => {
        attempt++
        if (attempt === 1) return { ok: false, reason: "storage unavailable" }
        return {
          ok: true,
          durable: true,
          part: makeSnapshotPart({
            sessionID: input.sessionID,
            messageID: input.target.info.id,
            partID: input.partID,
            text: input.text,
            metadata: input.metadata,
          }),
        }
      },
    )
    const first = boundaryFixture()
    await transformWith(deps, first)
    const second = boundaryFixture()
    await transformWith(deps, second)
    expect(reads).toEqual(["s1", "s1"])
    expect(writes).toHaveLength(2)
  })

  test("reconstructs durable coverage after restart without rewriting it", async () => {
    const firstDeps = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    await transformWith(firstDeps.deps, messages)

    const secondDeps = fakeDeps(async () => ({ ok: true, todos }))
    await transformWith(secondDeps.deps, messages)
    expect(secondDeps.reads).toEqual(["s1"])
    expect(secondDeps.writes).toEqual([])
  })

  test("restores from cached todos when an authoritative snapshot was pruned", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    messages[2]!.parts = messages[2]!.parts.filter((part) => !hasReminderPart({ info: messages[2]!.info, parts: [part] }))
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1"])
    expect(writes).toHaveLength(2)
  })

  test("retires plugin text after a successful native update", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    messages.push(
      assistant("a2", 30, { parentID: "u2", finish: "tool-calls" }, [
        toolPart({ id: "tool-ok", messageID: "a2", todos }),
      ]),
    )
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1"])
    expect(writes).toHaveLength(1)
    expect(messages.some((message) => hasReminderPart(message))).toBe(false)
  })

  test("does not retire memory for a failed todo write", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    messages.push(
      assistant("a2", 30, { parentID: "u2", finish: "tool-calls" }, [
        toolPart({ id: "tool-failed", messageID: "a2", todos, failed: true }),
      ]),
    )
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1"])
    expect(writes).toHaveLength(1)
  })

  test("invalidates cached state on an external todo update", async () => {
    let current = todos
    const next = [{ content: "new task", status: "pending", priority: "high" }]
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos: current }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    current = next
    await hooks.event!({ event: { type: "todo.updated", properties: { sessionID: "s1", todos: next } } } as never)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1", "s1"])
    expect(writes).toHaveLength(2)
    expect(messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("new task")))).toBe(true)
  })

  test("caches a successful empty result without repeated reads", async () => {
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos: [] }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1"])
    expect(writes).toEqual([])
  })

  test("does not let an older native update suppress newer persisted state", async () => {
    const newer = [{ content: "newer", status: "pending", priority: "high" }]
    let current = todos
    const { deps, reads, writes } = fakeDeps(async () => ({ ok: true, todos: current }))
    const messages = boundaryFixture()
    const hooks = createTodoReconcileHooks(deps)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    messages.push(
      assistant("a2", 30, { parentID: "u2", finish: "tool-calls" }, [
        toolPart({ id: "tool-old", messageID: "a2", todos }),
      ]),
    )
    current = newer
    await hooks.event!({ event: { type: "todo.updated", properties: { sessionID: "s1", todos: newer } } } as never)
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    expect(reads).toEqual(["s1", "s1"])
    expect(writes).toHaveLength(2)
    expect(messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("newer")))).toBe(true)
  })

  test("keeps sessions isolated", async () => {
    const { deps, reads } = fakeDeps(async (sessionID) => ({
      ok: true,
      todos: [{ content: `todo for ${sessionID}`, status: "pending", priority: "low" }],
    }))
    await transformWith(deps, boundaryFixture({ sessionID: "s1" }))
    await transformWith(deps, boundaryFixture({ sessionID: "s2" }))
    expect(reads).toEqual(["s1", "s2"])
  })
})

describe("readTodosThroughClient", () => {
  test("maps a successful response and preserves order", async () => {
    const client = {
      session: {
        todo: async () =>
          ({
            data: [
              { content: "a", status: "pending", priority: "high" },
              { content: "b", status: "completed", priority: "low" },
            ],
          }) satisfies TodoResponse,
      },
    }
    const result = await readTodosThroughClient(client, "s1")
    expect(result).toEqual({
      ok: true,
      todos: [
        { content: "a", status: "pending", priority: "high" },
        { content: "b", status: "completed", priority: "low" },
      ],
    })
  })

  test("distinguishes an empty successful response from a failure", async () => {
    const empty = await readTodosThroughClient({ session: { todo: async () => ({ data: [] }) } }, "s1")
    expect(empty).toEqual({ ok: true, todos: [] })
    const failed: TodoResponse = { error: { data: { message: "not found" } } }
    const error = await readTodosThroughClient({ session: { todo: async () => failed } }, "s1")
    expect(error.ok).toBe(false)
  })

  test("treats a response without data as a failure", async () => {
    const result = await readTodosThroughClient({ session: { todo: async () => ({}) } }, "s1")
    expect(result.ok).toBe(false)
  })

  test("rejects malformed items instead of fabricating values", async () => {
    const result = await readTodosThroughClient(
      {
        session: {
          todo: async () =>
            ({ data: [{ content: "a", status: undefined, priority: "high" }] }) as unknown as TodoResponse,
        },
      },
      "s1",
    )
    expect(result.ok).toBe(false)
  })

  test("treats a thrown error as a failure", async () => {
    const result = await readTodosThroughClient(
      {
        session: {
          todo: async () => {
            throw new Error("offline")
          },
        },
      },
      "s1",
    )
    expect(result).toEqual({ ok: false, reason: "offline" })
  })
})
