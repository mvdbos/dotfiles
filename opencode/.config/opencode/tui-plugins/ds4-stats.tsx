/** @jsxImportSource @opentui/solid */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs"
import { homedir } from "node:os"
import { basename } from "node:path"
import { createEffect, createSignal } from "solid-js"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message } from "@opencode-ai/sdk/v2"
import {
  createParser,
  ds4ProviderIDs,
  formatHit,
  formatRate,
  hitLevel,
  linkMessages,
  rateLevel,
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

function assistantMessages(messages: ReadonlyArray<Message>): MessageLike[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? [
          {
            id: message.id,
            role: message.role,
            providerID: message.providerID,
            modelID: message.modelID,
            time: message.time,
            tokens: message.tokens,
          },
        ]
      : [],
  )
}

// Renders the active session's averages, and only for sessions actually
// talking to the local ds4 server. The log supplies real server-side
// prefill/decode rates; message token usage supplies the cache hit percentage
// (and stays exact per session even when attribution lags).
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
  let decode: TextRenderable | undefined
  let prefill: TextRenderable | undefined
  let cache: TextRenderable | undefined

  const theme = props.api.theme.current
  const color = (level: Level) =>
    level === "good"
      ? theme.success
      : level === "warn"
        ? theme.warning
        : level === "bad"
          ? theme.error
          : theme.textMuted

  const write = (node: TextRenderable | undefined, value: string, level: Level) => {
    if (!node) return
    node.content = value.padStart(8)
    node.fg = color(level)
  }

  createEffect(() => {
    const stats = props.stats(props.sessionID)
    if (box) box.visible = stats !== undefined
    if (!stats) return
    write(decode, formatRate(stats.decodeRate), rateLevel(stats.decodeRate))
    write(prefill, formatRate(stats.prefillRate), rateLevel(stats.prefillRate))
    write(cache, formatHit(stats.hitPercent), hitLevel(stats.hitPercent))
  })

  return (
    <box ref={(node) => (box = node)} flexDirection="column">
      <text fg={theme.textMuted}>{`${props.source.label} · session avg`}</text>
      <box flexDirection="row">
        <text fg={theme.textMuted}>decode </text>
        <text ref={(node) => (decode = node)}>--</text>
        <text fg={theme.textMuted}> tok/s</text>
      </box>
      <box flexDirection="row">
        <text fg={theme.textMuted}>prefill</text>
        <text ref={(node) => (prefill = node)}>--</text>
        <text fg={theme.textMuted}> tok/s</text>
      </box>
      <box flexDirection="row">
        <text fg={theme.textMuted}>cache  </text>
        <text ref={(node) => (cache = node)}>--</text>
        <text fg={theme.textMuted}> hit</text>
      </box>
    </box>
  )
}

const plugin: TuiPlugin = async (api, options) => {
  const settings = resolveSettings(options)
  const source = resolveLog(settings)

  const parser = createParser()
  const claims = new Map<string, number>()
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

  const compute = (sessionID: string): SessionStats | undefined => {
    version()
    try {
      const messages = api.state.session.messages(sessionID)
      const model = sessionModelRef(messages)
      if (!model) return undefined
      const providers = settings.providers ?? ds4ProviderIDs(api.state.config, process.env)
      if (!providers.includes(model.providerID)) return undefined
      const likes = usageMessages(assistantMessages(messages), providers)
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

  const unsubscribe = api.event.on("message.updated", (event) => {
    const info = event.properties.info
    if (info.role === "assistant" && info.time.completed) setVersion((current) => current + 1)
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
    unsubscribe()
  })
}

export default {
  id: "ds4-stats",
  tui: plugin,
}
