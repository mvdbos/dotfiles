import { join } from "node:path"

// Pure logic for the ds4-stats TUI plugin. Ports the ds4-monitor log grammar
// (prefill chunk / decoding chunk / prompt start|done / gen / finish) into a
// request-record parser, then correlates requests with OpenCode assistant
// messages by prompt token totals and aggregates per-session averages.

export type Variant = "ds4" | "q38fn" | "custom"

export type LogSource = {
  variant: Variant
  label: string
  log: string
}

export type Env = Record<string, string | undefined>

export type RequestRecord = {
  id: number
  total: number
  reused: number
  prefetched: number
  prefillSecs?: number
  gen?: number
  decodeSecs?: number
  finished: boolean
}

export type TokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type MessageLike = {
  id: string
  role?: string
  providerID?: string
  modelID?: string
  model?: { providerID?: string; modelID?: string }
  time?: { created?: number; completed?: number }
  tokens?: TokenUsage
}

export type SessionStats = {
  turns: number
  matched: number
  prefillTokens: number
  prefillSecs: number
  prefillRate?: number
  decodeTokens: number
  decodeSecs: number
  decodeRate?: number
  hitRead: number
  hitTotal: number
  hitPercent?: number
  // ds4 server busy seconds across matched requests: prefill + decode time.
  // Tool execution and user idle time live outside the log, so they never
  // enter this number.
  durationSecs: number
  // Wall-clock seconds spent in finalized (completed or errored, including
  // aborted) tool parts of the counted messages, with overlapping intervals
  // merged so parallel calls are not double counted. Human-wait tools
  // (question) are skipped: their span is user deliberation, not agent work.
  toolDurationSecs: number
  // durationSecs + toolDurationSecs: every busy second of the session's ds4
  // turns. Still excludes user idle, queue waits and unmatched requests.
  totalDurationSecs: number
}

export type ToolTime = {
  messageID: string
  // ToolPart.tool, so human-wait tools can be recognized.
  tool: string
  // Epoch milliseconds, straight from ToolPart.state.time.
  start: number
  end: number
}

// Tools whose span measures user deliberation instead of agent work: the
// question tool stays running until the user answers, so its wall time is
// human idle and must not enter the busy totals.
export const HUMAN_WAIT_TOOLS: ReadonlySet<string> = new Set(["question"])

export type Level = "good" | "warn" | "bad" | "none"

export type ModelRef = { providerID: string; modelID: string }

// The session's effective model: the latest message that names one. Assistant
// messages carry providerID/modelID, user messages carry model.{providerID,modelID}.
export function sessionModelRef(messages: readonly MessageLike[]): ModelRef | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const providerID = message.providerID ?? message.model?.providerID
    const modelID = message.modelID ?? message.model?.modelID
    if (providerID && modelID) return { providerID, modelID }
  }
  return undefined
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"])

export function isDs4BaseURL(baseURL: string | undefined, host: string, port: string | number): boolean {
  if (!baseURL) return false
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return false
  }
  const expectedPort = String(port)
  const actualPort = url.port || (url.protocol === "https:" ? "443" : "80")
  if (actualPort !== expectedPort) return false
  if (url.hostname === host) return true
  return LOOPBACK.has(url.hostname) && LOOPBACK.has(host)
}

// Providers that point at the local ds4 server, so a session using one of
// them is what the log actually reflects. DS4_HOST/DS4_PORT mirror the start
// scripts (both variants share the same default port).
export function ds4ProviderIDs(config: unknown, env: Env): string[] {
  const providers = (config as { provider?: Record<string, { options?: Record<string, unknown> }> } | undefined)
    ?.provider
  if (!providers) return []
  const host = env.DS4_HOST || "127.0.0.1"
  const port = env.DS4_PORT || "8000"
  const ids: string[] = []
  for (const [id, provider] of Object.entries(providers)) {
    const baseURL = provider?.options?.baseURL
    if (typeof baseURL === "string" && isDs4BaseURL(baseURL, host, port)) ids.push(id)
  }
  return ids
}

export function sourceForVariant(variant: "ds4" | "q38fn", env: Env, home: string): LogSource {
  const logDir = env.DS4_LOG_DIR || join(home, "Library", "Logs", "ds4")
  if (variant === "q38fn") {
    return { variant, label: "Qwen3.8 Flash Next", log: join(logDir, "ds4-q38fn-server.log") }
  }
  return { variant, label: "DwarfStar", log: join(logDir, "ds4-server.log") }
}

// Mirrors ds4-monitor's variant auto-detection: q38fn wins when its pid file
// is alive, otherwise ds4. DS4_RUN_DIR overrides both run dirs.
export function resolveSource(input: {
  env: Env
  home: string
  pidAlive: (pidFile: string) => boolean
}): LogSource {
  const q38fnRunDir =
    input.env.DS4_Q38FN_RUN_DIR || input.env.DS4_RUN_DIR || join(input.home, ".cache", "ds4-q38fn")
  if (input.pidAlive(join(q38fnRunDir, "ds4-q38fn-server.pid"))) {
    return sourceForVariant("q38fn", input.env, input.home)
  }
  return sourceForVariant("ds4", input.env, input.home)
}

export type Parser = {
  push: (line: string) => void
  readonly requests: RequestRecord[]
}

// Request lifecycle, matching ds4-monitor's accumulators:
//   prompt start  -> new record (A reused .. B total : C prefetched)
//   prompt done   -> prefill seconds (weight: C prefetched tokens)
//   decoding      -> last decode elapsed
//   gen=N         -> generated tokens at finish
//   finish=reason -> finalize (weight: gen tokens / decode seconds)
export function createParser(): Parser {
  const requests: RequestRecord[] = []
  let nextID = 0
  let current: RequestRecord | undefined
  let genTotal: number | undefined
  let lastDecodeSecs: number | undefined

  const push = (line: string) => {
    if (!line) return

    if (/finish=/.test(line)) {
      if (current && !current.finished) {
        const gen = /gen=([0-9]+)/.exec(line)
        if (gen) genTotal = Number(gen[1])
        current.gen = genTotal
        current.decodeSecs = lastDecodeSecs
        current.finished = true
        requests.push(current)
      }
      return
    }

    const start = /chat ctx=([0-9]+)\.\.([0-9]+):([0-9]+).*prompt start$/.exec(line)
    if (start) {
      current = {
        id: nextID++,
        total: Number(start[2]),
        reused: Number(start[1]),
        prefetched: Number(start[3]),
        finished: false,
      }
      genTotal = undefined
      lastDecodeSecs = undefined
      return
    }

    const done = /prompt done ([0-9.]+)s$/.exec(line)
    if (done) {
      if (current && current.prefillSecs === undefined) {
        current.prefillSecs = Number(done[1])
      }
      return
    }

    const decode = /decoding chunk=[0-9.]+ t\/s avg=[0-9.]+ t\/s ([0-9.]+)s$/.exec(line)
    if (decode) {
      lastDecodeSecs = Number(decode[1])
    }

    const gen = /gen=([0-9]+)/.exec(line)
    if (gen) genTotal = Number(gen[1])
  }

  return { push, requests }
}

// Greedy, deterministic correlation: an assistant message's prompt total
// (input + cache read + cache write) equals the log request's total by
// construction, since both come from the same server. Requests are claimed at
// most once across sessions, in message-creation order.
export function linkMessages(input: {
  messages: readonly MessageLike[]
  requests: readonly RequestRecord[]
  claims: Map<string, number>
}): Map<string, RequestRecord> {
  const byID = new Map(input.requests.map((request) => [request.id, request]))
  const claimedRequests = new Set(input.claims.values())
  const pool = input.requests.filter(
    (request) =>
      request.finished &&
      request.prefillSecs !== undefined &&
      !claimedRequests.has(request.id),
  )
  const links = new Map<string, RequestRecord>()

  const ordered = [...input.messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  for (const message of ordered) {
    const claimed = input.claims.get(message.id)
    if (claimed !== undefined) {
      const request = byID.get(claimed)
      if (request) links.set(message.id, request)
      continue
    }
    if (!message.tokens) continue
    const total = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
    const index = pool.findIndex((request) => request.total === total)
    if (index < 0) continue
    const [request] = pool.splice(index, 1)
    input.claims.set(message.id, request.id)
    links.set(message.id, request)
  }
  return links
}

// Assistant messages that belong to the stats: completed usage from the ds4
// providers only, so sessions that switched models do not mix providers.
export function usageMessages(
  messages: readonly MessageLike[],
  providers: readonly string[],
): MessageLike[] {
  const allowed = new Set(providers)
  return messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.tokens !== undefined &&
      message.providerID !== undefined &&
      allowed.has(message.providerID),
  )
}

// Wall-clock tool seconds for the given messages, merging overlapping
// intervals so parallel calls are not double counted. Spans are epoch
// milliseconds; callers pass finalized parts only (running parts have no end).
// Human-wait tools are excluded by default; pass an empty set to keep them.
export function toolDurationSecs(
  parts: Iterable<ToolTime>,
  messageIDs: ReadonlySet<string>,
  excluded: ReadonlySet<string> = HUMAN_WAIT_TOOLS,
): number {
  const spans: Array<{ start: number; end: number }> = []
  for (const part of parts) {
    if (!messageIDs.has(part.messageID)) continue
    if (excluded.has(part.tool)) continue
    if (!Number.isFinite(part.start) || !Number.isFinite(part.end)) continue
    if (part.end <= part.start) continue
    spans.push({ start: part.start, end: part.end })
  }
  spans.sort((a, b) => a.start - b.start)
  let totalMs = 0
  let start: number | undefined
  let end = 0
  for (const span of spans) {
    if (start === undefined || span.start > end) {
      if (start !== undefined) totalMs += end - start
      start = span.start
      end = span.end
      continue
    }
    if (span.end > end) end = span.end
  }
  if (start !== undefined) totalMs += end - start
  return totalMs / 1000
}

export function sessionStats(
  messages: readonly MessageLike[],
  links: ReadonlyMap<string, RequestRecord>,
  toolTimes?: Iterable<ToolTime>,
): SessionStats {
  const stats: SessionStats = {
    turns: 0,
    matched: 0,
    prefillTokens: 0,
    prefillSecs: 0,
    decodeTokens: 0,
    decodeSecs: 0,
    hitRead: 0,
    hitTotal: 0,
    durationSecs: 0,
    toolDurationSecs: 0,
    totalDurationSecs: 0,
  }
  for (const message of messages) {
    const tokens = message.tokens
    if (!tokens) continue
    stats.turns += 1
    stats.hitRead += tokens.cache.read
    stats.hitTotal += tokens.input + tokens.cache.read + tokens.cache.write
    const request = links.get(message.id)
    if (!request) continue
    stats.matched += 1
    stats.durationSecs += (request.prefillSecs ?? 0) + (request.decodeSecs ?? 0)
    if (request.prefillSecs !== undefined && request.prefillSecs > 0) {
      stats.prefillTokens += request.prefetched
      stats.prefillSecs += request.prefillSecs
    }
    if (request.gen !== undefined && request.decodeSecs !== undefined && request.decodeSecs > 0) {
      stats.decodeTokens += request.gen
      stats.decodeSecs += request.decodeSecs
    }
  }
  stats.toolDurationSecs = toolTimes
    ? toolDurationSecs(toolTimes, new Set(messages.map((message) => message.id)))
    : 0
  stats.totalDurationSecs = stats.durationSecs + stats.toolDurationSecs
  if (stats.prefillSecs > 0) stats.prefillRate = stats.prefillTokens / stats.prefillSecs
  if (stats.decodeSecs > 0) stats.decodeRate = stats.decodeTokens / stats.decodeSecs
  if (stats.hitTotal > 0) stats.hitPercent = (stats.hitRead / stats.hitTotal) * 100
  return stats
}

// Same thresholds as ds4-monitor's rate_color / cache reuse coloring.
export function rateLevel(value: number | undefined): Level {
  if (value === undefined || !Number.isFinite(value)) return "none"
  if (value >= 20) return "good"
  if (value < 5) return "bad"
  return "warn"
}

export function hitLevel(value: number | undefined): Level {
  if (value === undefined || !Number.isFinite(value)) return "none"
  if (value >= 80) return "good"
  if (value < 50) return "bad"
  return "warn"
}

export function formatRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "--"
  return value.toFixed(1)
}

export function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "--"
  return Math.round(value).toString()
}

// Minutes below an hour, hours (plus minutes when nonzero) above; nothing
// below a full minute (callers hide it).
export function formatDuration(secs: number | undefined): string | undefined {
  if (secs === undefined || !Number.isFinite(secs)) return undefined
  const total = Math.floor(secs)
  if (total < 60) return undefined
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

export function formatHit(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "--"
  return `${value.toFixed(1)}%`
}
