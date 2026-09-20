import type { Event, Message, Part } from "@opencode-ai/sdk"
import type { Hooks } from "@opencode-ai/plugin"
import { CompactionSkipGuard } from "./guard"
import {
  baselineKeyOf,
  countWorkSince,
  findTodoWriteBaseline,
  formatTodoNudge,
  isEligibleNudgeTool,
  NUDGE_MARKER,
  shouldNudge,
  visibleTodoWritePart,
  type NudgeConfig,
  type NudgeWindow,
} from "./nudge"
import {
  DEFAULT_REMINDER_MAX_BYTES,
  formatTodoReminder,
  type ReminderTodo,
  type TodoProjection,
} from "./reminder"
import {
  canonicalTodoFingerprint,
  isPluginSnapshotPart,
  parseSnapshotMetadata,
  snapshotMetadata,
  snapshotPartID,
  snapshotRecord,
  type SnapshotMetadata,
  type SnapshotRecord,
} from "./snapshot"

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

export type TodoItem = ReminderTodo

export type TodoResponse = {
  data?: readonly TodoItem[]
  error?: unknown
}

export type TodoClient = {
  session: {
    todo(options: { path: { id: string } }): Promise<TodoResponse>
  }
}

export type ReadTodosResult = { ok: true; todos: TodoItem[] } | { ok: false; reason: string }

export type PersistSnapshotInput = {
  sessionID: string
  target: MessageWithParts
  boundaryID: string
  fingerprint: string
  projection: TodoProjection
  text: string
  partID: string
  metadata: SnapshotMetadata
}

export type PersistSnapshotResult =
  | { ok: true; part: Extract<Part, { type: "text" }> }
  | { ok: false; reason: string }

export type LifecycleDeps = {
  readTodos(sessionID: string): Promise<ReadTodosResult>
  /** Persisting is supplied by the plugin through `session.prompt(noReply)`. */
  persistSnapshot?(input: PersistSnapshotInput): Promise<PersistSnapshotResult>
  /** Stale-todo nudge policy; omitted means the documented defaults. */
  nudge?: NudgeConfig
  /** Clock override for tests. */
  now?: () => number
  log?(message: string, detail?: unknown): void
}

export type TodoReconcileHooks = Pick<
  Hooks,
  "experimental.chat.messages.transform" | "experimental.session.compacting" | "tool.execute.after" | "event" | "dispose"
>

type TransformOutput = Parameters<NonNullable<Hooks["experimental.chat.messages.transform"]>>[1]

export type Boundary = {
  parent: MessageWithParts
  summary: Extract<Message, { role: "assistant" }>
}

type HistoryInfo = {
  time: { created: number }
  id: string
}

type TodoUpdate = {
  key: HistoryInfo
  todos: TodoItem[]
  fingerprint: string
}

type SessionState = {
  boundaryID?: string
  readInFlight?: Promise<ReadTodosResult>
  sealed?: boolean
  nudge?: NudgeWindow & { nudged: boolean; hasTodos: boolean }
  nudgeAllowed?: boolean
  pendingProjection?: string
}

function isAfter(current: HistoryInfo, other: HistoryInfo): boolean {
  if (current.time.created !== other.time.created) return current.time.created > other.time.created
  return current.id > other.id
}

function compareHistory(current: HistoryInfo, other: HistoryInfo): number {
  return isAfter(current, other) ? 1 : isAfter(other, current) ? -1 : 0
}

/**
 * Latest successful compaction boundary. This mirrors OpenCode's completed
 * compaction check and compares timestamps/IDs rather than retained-tail array
 * positions.
 */
export function findCompactionBoundary(messages: readonly MessageWithParts[]): Boundary | undefined {
  const byID = new Map(messages.map((message) => [message.info.id, message]))
  let best: Boundary | undefined
  for (const message of messages) {
    const info = message.info
    if (info.role !== "assistant") continue
    if (info.summary !== true || !info.finish || info.error) continue
    const parent = byID.get(info.parentID)
    if (!parent || parent.info.role !== "user") continue
    if (!parent.parts.some((part) => part.type === "compaction")) continue
    if (!best || isAfter(info, best.summary)) best = { parent, summary: info }
  }
  return best
}

function latestCompactionParent(messages: readonly MessageWithParts[]): MessageWithParts | undefined {
  let best: MessageWithParts | undefined
  for (const message of messages) {
    if (message.info.role !== "user" || !message.parts.some((part) => part.type === "compaction")) continue
    if (!best || isAfter(message.info, best.info)) best = message
  }
  return best
}

function hasNewerUnsuccessfulCompaction(messages: readonly MessageWithParts[], boundary: Boundary): boolean {
  const parent = latestCompactionParent(messages)
  if (!parent || !isAfter(parent.info, boundary.summary)) return false
  const summaries = messages.filter(
    (message): message is MessageWithParts & { info: Extract<Message, { role: "assistant" }> } =>
      message.info.role === "assistant" && message.info.parentID === parent.info.id,
  )
  const summary = summaries.sort((left, right) => compareHistory(left.info, right.info)).at(-1)
  return !summary || !!summary.info.error || !summary.info.finish
}

/** Select the chronologically newest user message, not the retained-tail slot. */
export function lastUserMessage(messages: readonly MessageWithParts[]): MessageWithParts | undefined {
  let best: MessageWithParts | undefined
  for (const message of messages) {
    if (message.info.role !== "user") continue
    if (!best || isAfter(message.info, best.info)) best = message
  }
  return best
}

/**
 * The snapshot is written onto the newest user message. Persistence goes through
 * `session.prompt({ messageID })`, and OpenCode's `createUserMessage` always
 * replaces `time.created` with the persist time. Rewriting the newest user turn
 * keeps the message the newest one, so the write cannot reorder history or re-arm
 * `latest().tasks` compaction processing. Compaction markers are excluded: they
 * are never the write target, because their timestamp orders the retained-tail
 * boundary.
 */
export function persistTargetAllowed(target: MessageWithParts | undefined): boolean {
  if (!target) return false
  return !target.parts.some((part) => part.type === "compaction")
}

export function hasReminderPart(message: MessageWithParts): boolean {
  return message.parts.some((part) => isPluginSnapshotPart(part))
}

export function todowriteAvailable(message: MessageWithParts): boolean | undefined {
  if (message.info.role !== "user") return undefined
  const tools = message.info.tools
  if (!tools) return undefined
  if (tools.todowrite === false) return false
  if (tools.todowrite === true) return true
  return undefined
}

function todoFromUnknown(value: unknown): TodoItem | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as Record<string, unknown>
  if (typeof item.content !== "string" || typeof item.status !== "string" || typeof item.priority !== "string") {
    return undefined
  }
  return { content: item.content, status: item.status, priority: item.priority }
}

function todosFromUnknown(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const todos = value.map(todoFromUnknown)
  return todos.every((todo): todo is TodoItem => todo !== undefined) ? todos : undefined
}

function todosFromToolPart(part: Extract<Part, { type: "tool" }>): TodoItem[] | undefined {
  if (!visibleTodoWritePart(part) || part.state.status !== "completed") return undefined

  const input = part.state.input as Record<string, unknown>
  const fromInput = todosFromUnknown(input.todos) ?? todosFromUnknown(input)
  if (fromInput) return fromInput

  // Some tool adapters put the final list in their textual result instead.
  if (typeof part.state.output === "string") {
    try {
      const parsed = JSON.parse(part.state.output) as unknown
      if (parsed && typeof parsed === "object" && "todos" in parsed) {
        return todosFromUnknown((parsed as { todos: unknown }).todos)
      }
      return todosFromUnknown(parsed)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Newest successful, model-visible full todo update, optionally restricted to
 * updates after a boundary. Later parts within one assistant message win.
 */
export function findLatestNativeTodoUpdate(
  messages: readonly MessageWithParts[],
  after?: HistoryInfo,
): TodoUpdate | undefined {
  let best: TodoUpdate | undefined
  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.error) continue
    if (after && !isAfter(message.info, after)) continue
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const todos = todosFromToolPart(part)
      if (!todos) continue
      const update: TodoUpdate = {
        key: message.info,
        todos,
        fingerprint: canonicalTodoFingerprint(todos),
      }
      if (!best || isAfter(update.key, best.key) || !isAfter(best.key, update.key)) best = update
    }
  }
  return best
}

/** Find the newest successful, model-visible full todo update after a boundary. */
export function findNativeTodoCoverage(
  messages: readonly MessageWithParts[],
  boundary: Boundary,
): TodoUpdate | undefined {
  return findLatestNativeTodoUpdate(messages, boundary.summary)
}

function snapshotRecords(messages: readonly MessageWithParts[]): Array<SnapshotRecord & { message: MessageWithParts }> {
  const result: Array<SnapshotRecord & { message: MessageWithParts }> = []
  for (const message of messages) {
    for (const part of message.parts) {
      const record = snapshotRecord(part)
      if (record) result.push({ ...record, message })
    }
  }
  return result
}

function validatePersistedPart(
  part: Extract<Part, { type: "text" }>,
  input: PersistSnapshotInput,
): boolean {
  const metadata = parseSnapshotMetadata(part)
  return (
    part.id === input.partID &&
    part.sessionID === input.sessionID &&
    part.messageID === input.target.info.id &&
    part.text === input.text &&
    metadata?.boundaryID === input.boundaryID &&
    metadata.fingerprint === input.fingerprint
  )
}

export async function readTodosThroughClient(client: TodoClient, sessionID: string): Promise<ReadTodosResult> {
  try {
    const response = await client.session.todo({ path: { id: sessionID } })
    if (!response || response.error) return { ok: false, reason: describeError(response?.error) }
    if (!Array.isArray(response.data)) return { ok: false, reason: "todo response did not contain an array" }
    const todos: TodoItem[] = []
    for (const todo of response.data) {
      if (!todo || typeof todo.content !== "string" || typeof todo.status !== "string" || typeof todo.priority !== "string") {
        return { ok: false, reason: "todo response contained an invalid item" }
      }
      todos.push({ content: todo.content, status: todo.status, priority: todo.priority })
    }
    return { ok: true, todos }
  } catch (error) {
    return { ok: false, reason: describeError(error) }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "unknown error"
}

function resetState(state: SessionState, boundaryID: string): void {
  if (state.boundaryID === boundaryID) return
  state.boundaryID = boundaryID
  state.sealed = false
  state.pendingProjection = undefined
}

export function createTodoReconcileHooks(deps: LifecycleDeps): TodoReconcileHooks {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const states = new Map<string, SessionState>()
  const persistInFlight = new Map<string, Promise<PersistSnapshotResult>>()
  const compactionSkips = new CompactionSkipGuard()

  const stateFor = (sessionID: string): SessionState => {
    const existing = states.get(sessionID)
    if (existing) return existing
    const state: SessionState = {}
    states.set(sessionID, state)
    return state
  }

  const read = (sessionID: string, state: SessionState): Promise<ReadTodosResult> => {
    if (state.readInFlight) return state.readInFlight
    const pending = Promise.resolve()
      .then(() => deps.readTodos(sessionID))
      .catch((error): ReadTodosResult => ({ ok: false, reason: describeError(error) }))
      .finally(() => {
        if (state.readInFlight === pending) state.readInFlight = undefined
      })
    state.readInFlight = pending
    return pending
  }

  const persist = (input: PersistSnapshotInput): Promise<PersistSnapshotResult> => {
    const key = `${input.sessionID}:${input.boundaryID}:${input.fingerprint}:${input.target.info.id}`
    const existing = persistInFlight.get(key)
    if (existing) return existing

    const pending = Promise.resolve()
      .then(() =>
        deps.persistSnapshot
          ? deps.persistSnapshot(input)
          : ({ ok: false as const, reason: "no persistSnapshot dependency configured" }),
      )
      .catch((error): PersistSnapshotResult => ({ ok: false, reason: describeError(error) }))
      .finally(() => {
        if (persistInFlight.get(key) === pending) persistInFlight.delete(key)
      })
    persistInFlight.set(key, pending)
    return pending
  }

  const appendPart = (target: MessageWithParts, part: Extract<Part, { type: "text" }>): void => {
    const index = target.parts.findIndex((candidate) => candidate.id === part.id)
    if (index >= 0) target.parts[index] = part
    else target.parts.push(part)
  }

  const addProjection = async (input: {
    target: MessageWithParts
    boundary: Boundary
    todos: TodoItem[]
    fingerprint: string
    persistSafe: boolean
  }): Promise<void> => {
    const projection = formatTodoReminder(input.todos, {
      maxBytes: DEFAULT_REMINDER_MAX_BYTES,
      todowriteAvailable: todowriteAvailable(input.target),
    })
    if (!projection) {
      return
    }

    const metadata = snapshotMetadata({
      boundaryID: input.boundary.summary.id,
      fingerprint: input.fingerprint,
      projection,
      originatingContinuationID: input.target.info.id,
    })
    const persistInput: PersistSnapshotInput = {
      sessionID: input.target.info.sessionID,
      target: input.target,
      boundaryID: input.boundary.summary.id,
      fingerprint: input.fingerprint,
      projection,
      text: projection.text,
      partID: snapshotPartID({
        sessionID: input.target.info.sessionID,
        messageID: input.target.info.id,
        boundaryID: input.boundary.summary.id,
        fingerprint: input.fingerprint,
      }),
      metadata,
    }
    const result = input.persistSafe
      ? await persist(persistInput)
      : { ok: false as const, reason: "target is a compaction marker" }
    if (!result.ok) {
      log("todo snapshot persistence failed; compaction boundary sealed", {
        sessionID: input.target.info.sessionID,
        reason: result.reason,
      })
      return
    }

    if (!validatePersistedPart(result.part, persistInput)) {
      log("todo snapshot persistence returned an invalid part; compaction boundary sealed", {
        sessionID: input.target.info.sessionID,
      })
      return
    }

    appendPart(input.target, result.part)
  }

  const transform = async (_input: {}, output: TransformOutput): Promise<void> => {
    try {
      const messages = output.messages as MessageWithParts[]
      const target = lastUserMessage(messages)
      const sessionID = target?.info.sessionID ?? messages.find((message) => message.info.sessionID)?.info.sessionID

      // `experimental.session.compacting` arms this immediately before the
      // summarizer transform; skip every mutation for that request.
      if (sessionID && compactionSkips.consume(sessionID)) return

      if (sessionID) {
        const state = stateFor(sessionID)
        state.nudgeAllowed =
          target?.info.role !== "user" ||
          (target.info.agent !== "plan" && todowriteAvailable(target) !== false)
        const baseline = findTodoWriteBaseline(messages)
        if (baseline) {
          const baselineKey = baselineKeyOf(baseline)
          const native = findLatestNativeTodoUpdate(messages)
          const hasDeliveredNudge = messages.some((message) => {
            const relation = compareHistory(message.info, baseline.key)
            const parts = relation > 0
              ? message.parts
              : relation === 0
                ? message.parts.slice(baseline.partIndex + 1)
                : []
            return parts.some(
              (part) =>
                part.type === "tool" &&
                part.state.status === "completed" &&
                typeof part.state.output === "string" &&
                part.state.output.includes(NUDGE_MARKER),
            )
          })
          if (state.nudge?.baselineKey !== baselineKey) {
            state.nudge = {
              baselineKey,
              toolCalls: countWorkSince(messages, baseline),
              atMs: baseline.atMs,
              nudged: hasDeliveredNudge,
              hasTodos: (native?.todos.length ?? 0) > 0,
            }
          } else {
            state.nudge.toolCalls = countWorkSince(messages, baseline)
            state.nudge.nudged ||= hasDeliveredNudge
            state.nudge.hasTodos = (native?.todos.length ?? 0) > 0
          }
        }
      }

      const boundary = findCompactionBoundary(messages)
      if (!boundary || hasNewerUnsuccessfulCompaction(messages, boundary)) return
      if (!target || target.info.sessionID !== boundary.summary.sessionID) return

      const state = stateFor(target.info.sessionID)
      if (state.boundaryID !== boundary.summary.id) resetState(state, boundary.summary.id)
      if (state.sealed) return
      state.sealed = true
      const records = snapshotRecords(messages)
      const native = findNativeTodoCoverage(messages, boundary)
      if (records.some((record) => record.metadata.boundaryID === boundary.summary.id) || native) return
      if (messages.some((message) => message.info.role === "assistant" && isAfter(message.info, target.info))) {
        log("todo snapshot target was already sent; compaction boundary sealed", {
          sessionID: target.info.sessionID,
        })
        return
      }

      const result = await read(target.info.sessionID, state)
      if (!result.ok) {
        log("todo read failed; compaction boundary sealed without a snapshot", {
          sessionID: target.info.sessionID,
          reason: result.reason,
        })
        return
      }

      const fingerprint = canonicalTodoFingerprint(result.todos)
      if (result.todos.length === 0) return
      await addProjection({
        target,
        boundary,
        todos: result.todos,
        fingerprint,
        persistSafe: persistTargetAllowed(target),
      })
    } catch (error) {
      log("todo reconciliation hook failed; request left unchanged", { reason: describeError(error) })
    }
  }

  return {
    "experimental.session.compacting": async (input: { sessionID: string }) => {
      compactionSkips.arm(input.sessionID)
    },
    "experimental.chat.messages.transform": transform,
    "tool.execute.after": async (input, output) => {
      const state = states.get(input.sessionID)
      if (!state?.nudgeAllowed) return

      if (input.tool === "todowrite") {
        state.pendingProjection = undefined
        const config = deps.nudge
        if (!config?.enabled) return
        const values = todosFromUnknown((input.args as { todos?: unknown } | undefined)?.todos)
        state.nudge = {
          baselineKey: `call:${input.callID}`,
          toolCalls: 0,
          atMs: now(),
          nudged: false,
          hasTodos: Boolean(values?.length),
        }
        return
      }
      if (!isEligibleNudgeTool(input.tool)) return
      if (state.pendingProjection) {
        output.output += `\n\n${state.pendingProjection}`
        state.pendingProjection = undefined
      }

      const config = deps.nudge
      if (!config?.enabled) return
      if (!state.nudge || state.nudge.nudged || !state.nudge.hasTodos) return

      state.nudge.toolCalls += 1
      const elapsedMs = Math.max(0, now() - state.nudge.atMs)
      if (
        !shouldNudge({
          config,
          baselineKey: state.nudge.baselineKey,
          toolCalls: state.nudge.toolCalls,
          elapsedMs,
          nowMs: now(),
        })
      ) return

      output.output += `\n\n${formatTodoNudge({ toolCalls: state.nudge.toolCalls, elapsedMs })}`
      state.nudge.nudged = true
      log("stale todo reminder appended to tool output", { sessionID: input.sessionID })
    },
    event: async ({ event }: { event: Event }) => {
      if (event.type !== "todo.updated") return
      const sessionID = event.properties.sessionID
      const state = states.get(sessionID)
      if (!state) return
      const todos = todosFromUnknown(event.properties.todos)
      if (!state.boundaryID || !todos?.length) return
      state.pendingProjection = formatTodoReminder(todos, {
        maxBytes: DEFAULT_REMINDER_MAX_BYTES,
        heading: "Todo state update after compaction",
      })?.text
    },
    dispose: async () => {
      states.clear()
      persistInFlight.clear()
      compactionSkips.clearAll()
    },
  }
}
