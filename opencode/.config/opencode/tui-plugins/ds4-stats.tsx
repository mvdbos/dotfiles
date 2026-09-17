/** @jsxImportSource @opentui/solid */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs"
import { homedir } from "node:os"
import { basename } from "node:path"
import { createEffect, createSignal } from "solid-js"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
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
// Only message info is kept; parts are discarded.
export async function fetchAllMessages(
  client: OpencodeClient,
  sessionID: string,
): Promise<MessageLike[]> {
  const messages: MessageLike[] = []
  const seen = new Set<string>()
  let before: string | undefined
  for (;;) {
    const result = await client.session.messages({
      sessionID,
      limit: HISTORY_PAGE,
      ...(before ? { before } : {}),
    })
    if (!Array.isArray(result.data) || result.data.length === 0) break
    for (const entry of result.data) messages.push(entry.info as MessageLike)
    const cursor = result.response.headers.get("x-next-cursor")
    if (!cursor || seen.has(cursor)) break
    seen.add(cursor)
    before = cursor
  }
  return messages.sort(compareMessages)
}

// Renders the active session's averages, and only for sessions actually
// talking to the local ds4 server. The log supplies real server-side
// prefill/decode rates and busy seconds; message token usage supplies the
// cache hit percentage (and stays exact per session even when attribution
// lags). Rate numbers are neutral by design: prefill/decode speed swings with
// workload, so only cache hit carries good/warn/bad coloring.
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
  let durSeparator: TextRenderable | undefined
  let dur: TextRenderable | undefined

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
    const duration = formatDuration(stats.durationSecs)
    if (durSeparator) durSeparator.visible = duration !== undefined
    if (dur) {
      dur.visible = duration !== undefined
      if (duration) dur.content = duration
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
        <text ref={(node) => (durSeparator = node)} fg={theme.textMuted}>
          {" · model work "}
        </text>
        <text ref={(node) => (dur = node)}>--</text>
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

  const load = (sessionID: string) => {
    if (disposed || loading.has(sessionID)) return
    loading.add(sessionID)
    fetchAllMessages(api.client, sessionID)
      .then((messages) => {
        if (disposed) return
        // Event upserts that landed while the pages were in flight are newer
        // than the snapshot; keep them over the fetched copy.
        const byID = new Map(messages.map((message) => [message.id, message]))
        for (const message of history.get(sessionID) ?? []) byID.set(message.id, message)
        history.set(sessionID, [...byID.values()].sort(compareMessages))
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
      return sessionStats(likes, links)
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

  const unsubscribeRemoved = api.event.on("message.removed", (event) => {
    const { sessionID, messageID } = event.properties
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
    unsubscribeRemoved()
  })
}

export default {
  id: "ds4-stats",
  tui: plugin,
}
