import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import {
  assistantMessages,
  cleanup,
  createSession,
  hasPluginEvent,
  messageText,
  messages,
  MockMlx,
  OPENCODE_BIN,
  pluginEvents,
  promptAsync,
  startInstance,
  userMessages,
  waitFor,
  type FixtureReply,
  type Instance,
} from "./harness"

const binAvailable = existsSync(OPENCODE_BIN)
const maybe = binAvailable ? test : test.skip
const TEST_TIMEOUT = 90_000

const mock = new MockMlx()
const live: Instance[] = []

type TurnHandler = (body: Record<string, any>, turn: number) => FixtureReply

function handlerFor(turn: TurnHandler) {
  let turnIndex = 0
  return (body: Record<string, any>): FixtureReply => {
    if (String(body?.messages?.[0]?.content ?? "").includes("Generate a title for this conversation")) {
      return { kind: "text", text: "Mock title" }
    }
    return turn(body, turnIndex++)
  }
}

async function launch(retries?: number): Promise<Instance> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const instance = await startInstance({ mockBaseURL: mock.baseURL, retries })
      live.push(instance)
      return instance
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  throw lastError
}

async function waitForFinalText(instance: Instance, sessionID: string, text: string): Promise<void> {
  await waitFor(
    `final assistant text "${text}"`,
    async () => {
      const list = await messages(instance, sessionID)
      const last = assistantMessages(list).at(-1)
      if (last?.info.finish !== "stop") return
      return messageText(last).includes(text) ? true : undefined
    },
    TEST_TIMEOUT,
  )
}

afterEach(async () => {
  for (const instance of live.splice(0)) await cleanup(instance)
  mock.requests.length = 0
})

afterAll(async () => {
  await mock.stop()
})

describe("mlx-serve loop retry integration", () => {
  maybe(
    "retries once after a repetition loop and keeps a single user message",
    async () => {
      mock.handler = handlerFor((_body, turn) =>
        turn === 0 ? { kind: "loop", text: "loop loop loop" } : { kind: "text", text: "healthy answer" },
      )
      const instance = await launch()
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "hello there")
      await waitForFinalText(instance, sessionID, "healthy answer")

      expect(mock.turnRequests()).toHaveLength(2)
      const list = await messages(instance, sessionID)
      const users = userMessages(list)
      expect(users).toHaveLength(1)
      const last = assistantMessages(list).at(-1)!
      expect(last.info.parentID).toBe(users[0]!.info.id)
      expect(pluginEvents(instance).filter((event) => event === "retry-started")).toHaveLength(1)
      expect(hasPluginEvent(instance, "loop-detected")).toBe(true)
    },
    TEST_TIMEOUT,
  )

  maybe(
    "exhausts after three retries and leaves the looped reply in place",
    async () => {
      mock.handler = handlerFor(() => ({ kind: "loop", text: "loop loop loop" }))
      const instance = await launch()
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "hello there")
      await waitFor("exhausted event", () => (hasPluginEvent(instance, "exhausted") ? true : undefined), TEST_TIMEOUT)

      expect(mock.turnRequests()).toHaveLength(4)
      expect(pluginEvents(instance).filter((event) => event === "retry-started")).toHaveLength(3)
      const list = await messages(instance, sessionID)
      expect(userMessages(list)).toHaveLength(1)
      const last = assistantMessages(list).at(-1)!
      expect(last.info.finish).toBe("length")
    },
    TEST_TIMEOUT,
  )

  maybe(
    "retries: 0 disables detection and retry",
    async () => {
      mock.handler = handlerFor(() => ({ kind: "text", text: "plain answer" }))
      const instance = await launch(0)
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "hello there")
      await waitForFinalText(instance, sessionID, "plain answer")

      expect(mock.turnRequests()).toHaveLength(1)
      const events = pluginEvents(instance)
      expect(events).not.toContain("loop-detected")
      expect(events).not.toContain("retry-started")
      expect(events).not.toContain("exhausted")
    },
    TEST_TIMEOUT,
  )

  maybe(
    "plain length finishes are left alone",
    async () => {
      mock.handler = handlerFor(() => ({ kind: "length", text: "truncated answer" }))
      const instance = await launch()
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "hello there")
      await waitFor(
        "length finish",
        async () => {
          const list = await messages(instance, sessionID)
          const last = assistantMessages(list).at(-1)
          return last?.info.finish === "length" ? true : undefined
        },
        TEST_TIMEOUT,
      )

      expect(mock.turnRequests()).toHaveLength(1)
      expect(hasPluginEvent(instance, "loop-detected")).toBe(false)
      expect(pluginEvents(instance)).not.toContain("retry-started")
    },
    TEST_TIMEOUT,
  )

  maybe(
    "stamps session and user message correlation headers",
    async () => {
      mock.handler = handlerFor(() => ({ kind: "text", text: "correlated answer" }))
      const instance = await launch()
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "hello there")
      await waitForFinalText(instance, sessionID, "correlated answer")

      const request = mock.turnRequests()[0]!
      const list = await messages(instance, sessionID)
      const user = userMessages(list)[0]!
      expect(request.headers["x-session-affinity"]).toBe(sessionID)
      expect(request.headers["x-session-id"]).toBe(sessionID)
      expect(request.headers["x-mlx-serve-loop-request"]).toBe(user.info.id)
    },
    TEST_TIMEOUT,
  )

  maybe(
    "passes assistant text through verbatim",
    async () => {
      const text = 'verbatim ✓ line with `code` and "quotes"'
      mock.handler = handlerFor(() => ({ kind: "text", text }))
      const instance = await launch()
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "hello there")
      await waitForFinalText(instance, sessionID, text)

      const list = await messages(instance, sessionID)
      expect(messageText(assistantMessages(list).at(-1)!)).toContain(text)
    },
    TEST_TIMEOUT,
  )

  maybe(
    "rewinds a multi-step turn that ends in a loop and regenerates it",
    async () => {
      mock.handler = handlerFor((_body, turn) => {
        if (turn === 0) return { kind: "tool", tool: "bash", args: { command: "echo step-one" } }
        if (turn === 1) return { kind: "loop", text: "loop after tool" }
        return { kind: "text", text: "recovered after rewind" }
      })
      const instance = await launch()
      const sessionID = await createSession(instance)
      await promptAsync(instance, sessionID, "run the step")
      await waitForFinalText(instance, sessionID, "recovered after rewind")

      expect(mock.turnRequests()).toHaveLength(3)
      const list = await messages(instance, sessionID)
      expect(userMessages(list)).toHaveLength(1)
      const assistants = assistantMessages(list)
      expect(assistants).toHaveLength(1)
      expect(messageText(assistants[0]!)).toContain("recovered after rewind")
      expect(hasPluginEvent(instance, "retry-started")).toBe(true)
    },
    TEST_TIMEOUT,
  )
})
