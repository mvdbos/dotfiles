/** @jsxImportSource @opentui/solid */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs"
import { homedir } from "node:os"
import { basename } from "node:path"
import { createEffect, createSignal } from "solid-js"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"
import {
  createParser,
  ds4ProviderIDs,
  formatCount,
  formatDuration,
  formatHit,
  formatRate,
  hitLevel,
  linkMessages,
  resolveSource,
  sessionModelRef,
  sessionStats,
  sourceForVariant,
  usageMessages,
  type Level,
  type LogSource,
  type MessageLike,
  type SessionStats,
  type ToolTime,
} from "../ds4-stats/helpers"

const DEFAULT_POLL_MS = 1000

type Settings = {
  log?: string
  variant?: "ds4" | "q38fn"
  providers?: string[]
  pollMs: number
}

function resolveSettings(options: Record<string, unknown> | undefined): Settings {
  const raw = options ?? {}
  const variant = raw.variant === "ds4" || raw.variant === "q38fn" ? raw.variant : undefined
  const providerList = Array.isArray(raw.providers)
    ? raw.providers.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : typeof raw.provider === "string" && raw.provider.length > 0
      ? [raw.provider]
      : undefined
  const pollMs =
    typeof raw.pollMs === "number" && Number.isFinite(raw.pollMs) && raw.pollMs >= 100
      ? Math.floor(raw.pollMs)
      : DEFAULT_POLL_MS
  return {
    log: typeof raw.log === "string" && raw.log.length > 0 ? raw.log : undefined,
    variant,
    providers: providerList && providerList.length > 0 ? providerList : undefined,
    pollMs,
  }
}

function resolveLog(settings: Settings): LogSource {
  if (settings.log) return { variant: "custom", label: basename(settings.log), log: settings.log }
  if (settings.variant) return sourceForVariant(settings.variant, process.env, homedir())
  const pidAlive = (pidFile: string): boolean => {
    try {
      const pid = Number(readFileSync(pidFile, "utf8").trim())
      if (!Number.isInteger(pid) || pid <= 0) return false
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  return resolveSource({ env: process.env, home: homedir(), pidAlive })
}

// Incremental tail: returns undefined while the log does not exist yet, the
// new text, and the offset to resume from.
function readFrom(path: string, offset: number): { text: string; size: number } | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, "r")
    const size = fstatSync(fd).size
    const start = size < offset ? 0 : offset
    if (size <= start) return { text: "", size }
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    return { text: buffer.toString("utf8"), size }
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {}
    }
  }
}

const HISTORY_PAGE = 100

const compareMessages = (a: MessageLike, b: MessageLike): number => {
  const created = (a.time?.created ?? 0) - (b.time?.created ?? 0)
  if (created !== 0) return created
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// The TUI store only keeps the last 100 messages of a session (its own
// session.messages call passes limit 100 and drops older entries), so
// session-wide stats cannot come from api.state.session.messages. The HTTP
// route pages newest-first and hands back an X-Next-Cursor header pointing at
// the next older page, so follow it until it is gone, then sort ascending.
// Entries' parts are reduced to finalized tool spans; everything else is
// dropped.
export type FetchedHistory = {
  messages: MessageLike[]
  parts: Array<ToolTime & { id: string }>
}

// A tool span usable for stats: finalized (completed or errored, including
// aborted) with a usable pair of epoch-millisecond timestamps. Running and
// pending parts have no end yet and are skipped.
export function toolSpan(part: Part): (ToolTime & { id: string }) | undefined {
  if (part.type !== "tool") return undefined
  const state = part.state
  if (state.status !== "completed" && state.status !== "error") return undefined
  const { start, end } = state.time
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined
  return { id: part.id, messageID: part.messageID, start, end }
}

export async function fetchAllMessages(
  client: OpencodeClient,
  sessionID: string,
): Promise<FetchedHistory> {
  const messages: MessageLike[] = []
  const parts: Array<ToolTime & { id: string }> = []
  const seen = new Set<string>()
  let before: string | undefined
  for (;;) {
    const result = await client.session.messages({
      sessionID,
      limit: HISTORY_PAGE,
      ...(before ? { before } : {}),
    })
    if (!Array.isArray(result.data) || result.data.length === 0) break
    for (const entry of result.data) {
      messages.push(entry.info as MessageLike)
      for (const part of entry.parts ?? []) {
        const span = toolSpan(part)
        if (span) parts.push(span)
      }
    }
    const cursor = result.response.headers.get("x-next-cursor")
    if (!cursor || seen.has(cursor)) break
    seen.add(cursor)
    before = cursor
  }
  return { messages: messages.sort(compareMessages), parts }
}

// Renders the active session's averages, and only for sessions actually
// talking to the local ds4 server. The log supplies real server-side
// prefill/decode rates and busy seconds; message token usage supplies the
// cache hit percentage (and stays exact per session even when attribution
// lags); finalized tool spans from message parts supply the tool wall time
// that total work adds. Rate numbers are neutral by design: prefill/decode
// speed swings with workload, so only cache hit carries good/warn/bad
// coloring.
//
// OpenCode 1.18.31 loads external file plugins without the Solid JSX transform
// (verified: dynamic JSX in a file plugin never re-evaluates), so this
// component must not rely on compiled-in reactivity. Structure is rendered
// once, and a plugin-side createEffect recomputes from the version signal and
// writes content/color/visibility into renderable refs imperatively.
export function Stats(props: {
  api: TuiPluginApi
  sessionID: string
  source: LogSource
  stats: (sessionID: string) => SessionStats | undefined
}) {
  let box: BoxRenderable | undefined
  let pp: TextRenderable | undefined
  let tg: TextRenderable | undefined
  let cache: TextRenderable | undefined
  let durModelLabel: TextRenderable | undefined
  let durModel: TextRenderable | undefined
  let durTotalLabel: TextRenderable | undefined
  let durTotal: TextRenderable | undefined

  const theme = props.api.theme.current
  const color = (level: Level) =>
    level === "good"
      ? theme.success
      : level === "warn"
        ? theme.warning
        : level === "bad"
          ? theme.error
          : theme.textMuted

  // Fixed-width right-aligned numbers keep the labels from shifting as values
  // change width.
  const set = (node: TextRenderable | undefined, value: string, width: number) => {
    if (node) node.content = value.padStart(width)
  }

  createEffect(() => {
    const stats = props.stats(props.sessionID)
    if (box) box.visible = stats !== undefined
    if (!stats) return
    set(pp, formatCount(stats.prefillRate), 4)
    set(tg, formatRate(stats.decodeRate), 5)
    if (cache) {
      cache.content = formatHit(stats.hitPercent).padStart(5)
      cache.fg = color(hitLevel(stats.hitPercent))
    }
    const model = formatDuration(stats.durationSecs)
    const total = formatDuration(stats.totalDurationSecs)
    // Total is always at least model, so model only ever shows alongside
    // total; a sub-minute model with minute-plus tools shows total alone.
    const showModel = model !== undefined && total !== undefined
    if (durModelLabel) durModelLabel.visible = showModel
    if (durModel) {
      durModel.visible = showModel
      if (model) durModel.content = model
    }
    if (durTotalLabel) durTotalLabel.visible = total !== undefined
    if (durTotal) {
      durTotal.visible = total !== undefined
      if (total) durTotal.content = total
    }
  })

  return (
    <box ref={(node) => (box = node)} flexDirection="column">
      <text fg={theme.textMuted}>{`${props.source.label} · session avg`}</text>
      <box flexDirection="row">
        <text fg={theme.textMuted}>pp </text>
        <text ref={(node) => (pp = node)}>--</text>
        <text fg={theme.textMuted}> · tg </text>
        <text ref={(node) => (tg = node)}>--</text>
        <text fg={theme.textMuted}> tok/s</text>
      </box>
      <box flexDirection="row">
        <text fg={theme.textMuted}>cache </text>
        <text ref={(node) => (cache = node)}>--</text>
        <text ref={(node) => (durModelLabel = node)} fg={theme.textMuted}>
          {" · model "}
        </text>
        <text ref={(node) => (durModel = node)}>--</text>
        <text ref={(node) => (durTotalLabel = node)} fg={theme.textMuted}>
          {" · total "}
        </text>
        <text ref={(node) => (durTotal = node)}>--</text>
      </box>
    </box>
  )
}

const plugin: TuiPlugin = async (api, options) => {
  const settings = resolveSettings(options)
  const source = resolveLog(settings)

  const parser = createParser()
  const claims = new Map<string, number>()
  const history = new Map<string, MessageLike[]>()
  const toolTimes = new Map<string, Map<string, ToolTime>>()
  const removedParts = new Set<string>()
  const removedMessages = new Set<string>()
  const loading = new Set<string>()
  const [version, setVersion] = createSignal(0)
  let offset = 0
  let partial = ""
  let disposed = false

  const ingest = () => {
    const chunk = readFrom(source.log, offset)
    if (!chunk) return
    const truncated = chunk.size < offset
    offset = chunk.size
    partial = truncated ? "" : partial
    if (!chunk.text) return
    const lines = (partial + chunk.text).split("\n")
    partial = lines.pop() ?? ""
    if (lines.length === 0) return
    for (const line of lines) {
      try {
        parser.push(line.replace(/\r$/, ""))
      } catch {}
    }
    setVersion((current) => current + 1)
  }

  // Tool spans merge by part ID and are fed unconditionally from plugin
  // start, independent of the message history cache: a completion that lands
  // while the first fetch is in flight must not be lost, and a fetched copy
  // must not overwrite a newer event span (keep the larger end). Removals are
  // tombstoned so an in-flight fetch cannot resurrect them.
  const recordToolSpan = (sessionID: string, span: ToolTime & { id: string }): boolean => {
    if (removedParts.has(span.id) || removedMessages.has(span.messageID)) return false
    let parts = toolTimes.get(sessionID)
    if (!parts) {
      parts = new Map()
      toolTimes.set(sessionID, parts)
    }
    const existing = parts.get(span.id)
    if (existing && existing.end >= span.end) return false
    parts.set(span.id, { messageID: span.messageID, start: span.start, end: span.end })
    return true
  }

  const load = (sessionID: string) => {
    if (disposed || loading.has(sessionID)) return
    loading.add(sessionID)
    fetchAllMessages(api.client, sessionID)
      .then(({ messages, parts }) => {
        if (disposed) return
        // Event upserts that landed while the pages were in flight are newer
        // than the snapshot; keep them over the fetched copy.
        const byID = new Map(messages.map((message) => [message.id, message]))
        for (const message of history.get(sessionID) ?? []) byID.set(message.id, message)
        history.set(sessionID, [...byID.values()].sort(compareMessages))
        for (const part of parts) recordToolSpan(sessionID, part)
        setVersion((current) => current + 1)
      })
      .catch(() => {})
      .finally(() => loading.delete(sessionID))
  }

  const compute = (sessionID: string): SessionStats | undefined => {
    version()
    const providers = settings.providers ?? ds4ProviderIDs(api.state.config, process.env)
    const messages = history.get(sessionID)
    if (!messages) {
      // Gate the full-history fetch on the TUI store's live tail: the newest
      // messages are exactly what it still holds. An empty tail means the
      // store has not loaded this session yet, so fetch rather than wait for
      // an event that will never come.
      const tail = api.state.session.messages(sessionID)
      const model = sessionModelRef(tail)
      if (tail.length === 0 || (model !== undefined && providers.includes(model.providerID))) load(sessionID)
      return undefined
    }
    try {
      const model = sessionModelRef(messages)
      if (!model) return undefined
      if (!providers.includes(model.providerID)) return undefined
      const likes = usageMessages(messages, providers)
      const links = linkMessages({ messages: likes, requests: parser.requests, claims })
      return sessionStats(likes, links, toolTimes.get(sessionID)?.values())
    } catch {
      return undefined
    }
  }

  ingest()
  const timer = setInterval(() => {
    if (disposed) return
    try {
      ingest()
    } catch {}
  }, settings.pollMs)

  const unsubscribeUpdated = api.event.on("message.updated", (event) => {
    const info = event.properties.info
    const cached = history.get(info.sessionID)
    if (cached) {
      const index = cached.findIndex((message) => message.id === info.id)
      if (index >= 0) cached[index] = info as MessageLike
      else cached.push(info as MessageLike)
    }
    if (info.role === "assistant" && info.time.completed) setVersion((current) => current + 1)
  })

  const unsubscribePartUpdated = api.event.on("message.part.updated", (event) => {
    const span = toolSpan(event.properties.part)
    if (!span) return
    if (recordToolSpan(event.properties.sessionID, span)) setVersion((current) => current + 1)
  })

  const unsubscribePartRemoved = api.event.on("message.part.removed", (event) => {
    const { sessionID, partID } = event.properties
    removedParts.add(partID)
    const parts = toolTimes.get(sessionID)
    if (parts?.delete(partID)) setVersion((current) => current + 1)
  })

  const unsubscribeRemoved = api.event.on("message.removed", (event) => {
    const { sessionID, messageID } = event.properties
    removedMessages.add(messageID)
    const parts = toolTimes.get(sessionID)
    if (parts) {
      let changed = false
      for (const [partID, span] of parts) {
        if (span.messageID === messageID) {
          parts.delete(partID)
          changed = true
        }
      }
      if (changed) setVersion((current) => current + 1)
    }
    const cached = history.get(sessionID)
    if (!cached) return
    const next = cached.filter((message) => message.id !== messageID)
    if (next.length === cached.length) return
    history.set(sessionID, next)
    setVersion((current) => current + 1)
  })

  api.slots.register({
    slots: {
      sidebar_content: (_ctx, props) => (
        <Stats api={api} sessionID={props.session_id} source={source} stats={compute} />
      ),
    },
  })

  api.lifecycle.onDispose(() => {
    disposed = true
    clearInterval(timer)
    unsubscribeUpdated()
    unsubscribePartUpdated()
    unsubscribePartRemoved()
    unsubscribeRemoved()
  })
}

export default {
  id: "ds4-stats",
  tui: plugin,
}
