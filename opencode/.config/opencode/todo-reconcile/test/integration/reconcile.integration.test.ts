import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import {
  cleanupAll,
  containsReminder,
  createSession,
  EXPECTED_VERSION,
  invalidPromptError,
  isSummarizerRequest,
  isTitleRequest,
  MockProvider,
  OPENCODE_BIN,
  prompt,
  readTodos,
  restartInstance,
  startInstance,
  summarize,
  textOf,
  todoCall,
  type Instance,
} from "./harness"

const projectRoot = path.resolve(import.meta.dir, "../..")
const bundlePath = path.join(projectRoot, "dist", "todo-reconcile.js")
const binAvailable = existsSync(OPENCODE_BIN)
const maybe = binAvailable ? test : test.skip

const pending = { content: "Investigate crash", status: "pending", priority: "high" }
const inProgress = { content: "Write regression test", status: "in_progress", priority: "medium" }
const completed = { content: "Update README", status: "completed", priority: "low" }
const cancelled = { content: "Drop obsolete migration", status: "cancelled", priority: "low" }

const mock = new MockProvider()
const live: Instance[] = []

function hasToolResult(body: Record<string, any>): boolean {
  return (body.messages ?? []).some((message: Record<string, any>) => message.role === "tool")
}

function setDefaultHandler(): void {
  mock.handler = (body) => {
    if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
    if (isSummarizerRequest(body)) return { kind: "text", text: "## Objective\n- mock summary" }
    if (textOf(body).includes("seed tasks") && !hasToolResult(body)) return todoCall([pending, inProgress, completed, cancelled])
    return { kind: "text", text: "done" }
  }
}

async function launch(): Promise<Instance> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const instance = await startInstance({ mockBaseURL: mock.baseURL, pluginBundle: bundlePath })
      live.push(instance)
      return instance
    } catch (error) {
      lastError = error
      await Bun.sleep(300)
    }
  }
  throw lastError
}

beforeAll(async () => {
  if (!binAvailable) return
  const build = Bun.spawnSync(
    ["bun", "build", "src/plugin.ts", "--outfile", bundlePath, "--target", "node", "--format", "esm"],
    { cwd: projectRoot },
  )
  if (build.exitCode !== 0) throw new Error(`plugin build failed: ${build.stderr.toString()}`)
  const version = Bun.spawnSync([OPENCODE_BIN, "--version"])
  const output = version.stdout.toString().trim()
  console.log(`[integration] tested OpenCode version: ${output} (expected ${EXPECTED_VERSION})`)
})

afterEach(async () => {
  await cleanupAll(live.splice(0))
})

afterAll(async () => {
  await mock.stop()
})

describe("todo reconciliation integration", () => {
  maybe(
    "snapshot persistence preserves reasoning effort across resumed tool steps",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)
      await prompt(instance, sessionID, "seed tasks", { variant: "low" })
      expect(mock.ordinaryRequests().every((request) => request.body.reasoning_effort === "low")).toBe(true)

      mock.requests.length = 0
      let resumedSteps = 0
      mock.handler = (body) => {
        if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
        if (isSummarizerRequest(body)) return { kind: "text", text: "## Objective\n- mock summary" }
        if (resumedSteps++ === 0) return todoCall([pending, inProgress, completed, cancelled])
        return { kind: "text", text: "done" }
      }
      await summarize(instance, sessionID, false)
      await prompt(instance, sessionID, "resume work", { variant: "low" })

      const resumed = mock.ordinaryRequests()
      expect(resumed.length).toBeGreaterThanOrEqual(2)
      expect(containsReminder(resumed[0]!.body)).toBe(true)
      expect(resumed.map((request) => request.body.reasoning_effort)).toEqual(resumed.map(() => "low"))
    },
    90_000,
  )

  maybe(
    "manual compaction: reminder reaches the resumed request but never the summarizer",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)

      await prompt(instance, sessionID, "seed tasks")
      expect(await readTodos(instance, sessionID)).toEqual([pending, inProgress, completed, cancelled])

      mock.requests.length = 0
      await summarize(instance, sessionID, false)

      const summarizer = mock.summarizerRequests()
      expect(summarizer.length).toBeGreaterThan(0)
      for (const request of summarizer) expect(containsReminder(request.body)).toBe(false)
      expect(mock.ordinaryRequests()).toHaveLength(0)

      await prompt(instance, sessionID, "next task")
      const ordinary = mock.ordinaryRequests()
      const withReminder = ordinary.filter((request) => containsReminder(request.body))
      expect(withReminder).toHaveLength(1)
      const reminderText = textOf(withReminder[0]!.body)
      expect(reminderText).toContain(pending.content)
      expect(reminderText).toContain(completed.content)
      expect(reminderText).toContain(cancelled.content)
      expect(reminderText).toContain("If todowrite is available")

      const messagesBefore = mock.ordinaryRequests().length
      await prompt(instance, sessionID, "next task again")
      const after = mock.ordinaryRequests().slice(messagesBefore)
      expect(after).toHaveLength(1)
       for (const request of after) expect(containsReminder(request.body)).toBe(true)

      expect(await readTodos(instance, sessionID)).toEqual([pending, inProgress, completed, cancelled])

      const history = await instance.client.session.messages({ path: { id: sessionID } })
      const persistedReminder = (history.data ?? []).some((message) =>
        message.parts.some((part) => part.type === "text" && part.metadata?.["todo-reconcile"] === true),
      )
       expect(persistedReminder).toBe(true)
    },
    90_000,
  )

  maybe(
    "automatic continuation after compaction carries the reminder",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)
      await prompt(instance, sessionID, "seed tasks")

      mock.requests.length = 0
      await summarize(instance, sessionID, true)

      for (const request of mock.summarizerRequests()) expect(containsReminder(request.body)).toBe(false)
      const refreshed = mock.ordinaryRequests().filter((request) => containsReminder(request.body))
      expect(refreshed).toHaveLength(1)
      expect(textOf(refreshed[0]!.body)).toContain("Continue if you have next steps")

      const before = mock.ordinaryRequests().length
      await prompt(instance, sessionID, "follow up")
       for (const request of mock.ordinaryRequests().slice(before)) expect(containsReminder(request.body)).toBe(true)
    },
    90_000,
  )

  maybe(
    "failed compaction does not qualify and the session keeps working",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)
      await prompt(instance, sessionID, "first")

      mock.requests.length = 0
      mock.handler = (body) => {
        if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
        if (isSummarizerRequest(body)) return invalidPromptError()
        return { kind: "text", text: "done" }
      }
      await summarize(instance, sessionID, false)
      expect(mock.summarizerRequests().length).toBeGreaterThan(0)

      mock.requests.length = 0
      await prompt(instance, sessionID, "after failure")
      expect(mock.requests.length).toBeGreaterThan(0)
      for (const request of mock.requests) expect(containsReminder(request.body)).toBe(false)
    },
    90_000,
  )

  maybe(
    "a retried first resumed request keeps the reminder",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)
      await prompt(instance, sessionID, "seed tasks")

      mock.requests.length = 0
      let postSummaryCalls = 0
      mock.handler = (body) => {
        if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
        if (isSummarizerRequest(body)) return { kind: "text", text: "## Objective\n- mock summary" }
        postSummaryCalls++
        if (postSummaryCalls === 1) {
          return { kind: "status", status: 500, body: { error: { code: "server_error", message: "transient" } } }
        }
        return { kind: "text", text: "done" }
      }
      await summarize(instance, sessionID, false)
      await prompt(instance, sessionID, "resume work")

      const ordinary = mock.ordinaryRequests()
      expect(ordinary.length).toBeGreaterThanOrEqual(2)
      for (const request of ordinary) expect(containsReminder(request.body)).toBe(true)
    },
    120_000,
  )

  maybe(
    "eligibility survives an OpenCode restart",
    async () => {
      setDefaultHandler()
      let instance = await launch()
      const sessionID = await createSession(instance)
      await prompt(instance, sessionID, "seed tasks")
      await prompt(instance, sessionID, "first")

      mock.requests.length = 0
      await summarize(instance, sessionID, false)

      instance = await restartInstance(instance, mock.baseURL)
      live.push(instance)

      mock.requests.length = 0
      mock.handler = (body) => {
        if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
        return { kind: "text", text: "done" }
      }
      await prompt(instance, sessionID, "after restart")

      const withReminder = mock.requests.filter((request) => containsReminder(request.body))
      expect(withReminder).toHaveLength(1)
      expect(textOf(withReminder[0]!.body)).toContain(pending.content)
    },
    150_000,
  )

  maybe(
    "empty todo lists are skipped",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)
      await prompt(instance, sessionID, "first")

      mock.requests.length = 0
      await summarize(instance, sessionID, false)
      mock.requests.length = 0
      await prompt(instance, sessionID, "next")
      expect(mock.ordinaryRequests().length).toBeGreaterThan(0)
      for (const request of mock.requests) expect(containsReminder(request.body)).toBe(false)
    },
    90_000,
  )

  maybe(
    "all-completed lists are included",
    async () => {
      setDefaultHandler()
      const instance = await launch()
      const sessionID = await createSession(instance)
      mock.handler = (body) => {
        if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
        if (isSummarizerRequest(body)) return { kind: "text", text: "## Objective\n- mock summary" }
        if (textOf(body).includes("seed tasks") && !hasToolResult(body)) return todoCall([completed, completed])
        return { kind: "text", text: "done" }
      }
      await prompt(instance, sessionID, "seed tasks")

      mock.requests.length = 0
      await summarize(instance, sessionID, false)
      mock.requests.length = 0
      await prompt(instance, sessionID, "next")
      const withReminder = mock.ordinaryRequests().filter((request) => containsReminder(request.body))
      expect(withReminder).toHaveLength(1)
       expect(textOf(withReminder[0]!.body)).toContain("Closed counts: completed=2, cancelled=0.")
    },
    90_000,
  )
})
