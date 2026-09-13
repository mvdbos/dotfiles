import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { decideIdle, parseSseLoopChunk, toastFor, toPromptParts, type PromptPart, type Toast } from "../mlx-serve-loop-retry/helpers"

const PREFIX = "[mlx-serve-loop-retry]"
const DEFAULT_RETRIES = 3
const DEFAULT_PROVIDER = "mlx-serve"
const REQUEST_HEADER = "x-mlx-serve-loop-request"
const WRAPPER_MARKER = "__mlxServeLoopRetry"

type RecordValue = Record<string, unknown>
type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null ? (value as RecordValue) : undefined
}

function logEvent(event: string, fields: RecordValue = {}) {
  console.error(`${PREFIX} ${JSON.stringify({ event, ...fields })}`)
}

function resolveSettings(options: PluginOptions | undefined) {
  const invalid: string[] = []
  if (!options) invalid.push("options")

  const rawRetries = options?.retries
  const retries =
    typeof rawRetries === "number" && Number.isInteger(rawRetries) && rawRetries >= 0 ? rawRetries : DEFAULT_RETRIES
  if (rawRetries !== undefined && retries !== rawRetries) invalid.push("retries")

  const rawProvider = options?.provider
  const provider = typeof rawProvider === "string" && rawProvider.length > 0 ? rawProvider : DEFAULT_PROVIDER
  if (rawProvider !== undefined && provider !== rawProvider) invalid.push("provider")

  return { retries, provider, invalid }
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  if (Array.isArray(headers)) {
    const match = headers.find(
      (item) => Array.isArray(item) && typeof item[0] === "string" && item[0].toLowerCase() === name.toLowerCase(),
    )
    return Array.isArray(match) && match[1] !== undefined ? String(match[1]) : undefined
  }
  const data = record(headers)
  if (!data) return undefined
  const lower = name.toLowerCase()
  const entry = Object.entries(data).find(([key]) => key.toLowerCase() === lower)
  return typeof entry?.[1] === "string" ? entry[1] : undefined
}

function requestHeaders(input: unknown, init: unknown): unknown {
  const initHeaders = record(init)?.headers
  if (initHeaders) return initHeaders
  if (input instanceof Request) return input.headers
  return undefined
}

function providerIdOf(provider: unknown): string | undefined {
  const direct = record(provider)?.id
  if (typeof direct === "string") return direct
  const nested = record(record(provider)?.info)?.id
  return typeof nested === "string" ? nested : undefined
}

async function readLoopBody(body: ReadableStream<Uint8Array>, onHit: () => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })
      const scan = parseSseLoopChunk(buffer)
      buffer = scan.rest
      if (scan.hit) {
        onHit()
        return
      }
    }
  } catch {
    // the inspector must never affect the response
  } finally {
    reader.cancel().catch(() => {})
  }
}

function sessionPrefix(sessionID: string) {
  return `${sessionID}:`
}

export const MlxServeLoopRetryPlugin: Plugin = async ({ client }, options) => {
  const settings = resolveSettings(options)
  const pending = new Set<string>()
  const attempts = new Map<string, number>()
  let missingCorrelationLogged = false

  if (settings.invalid.length > 0) {
    logEvent("invalid-options", {
      invalid: settings.invalid,
      retries: settings.retries,
      provider: settings.provider,
    })
  }

  if (settings.retries <= 0) {
    logEvent("disabled", { retries: settings.retries })
    return {}
  }

  const inspect = (response: Response, headers: unknown) => {
    try {
      if (!response.headers.get("content-type")?.includes("text/event-stream")) return
      const sessionID = headerValue(headers, "x-session-affinity") ?? headerValue(headers, "X-Session-Id")
      const userMessageID = headerValue(headers, REQUEST_HEADER)
      if (!sessionID || !userMessageID) {
        if (!missingCorrelationLogged) {
          missingCorrelationLogged = true
          logEvent("correlation-missing", { sessionID, userMessageID })
        }
        return
      }
      const body = response.clone().body
      if (!body) return
      const key = `${sessionID}:${userMessageID}`
      void readLoopBody(body, () => {
        pending.add(key)
        logEvent("loop-detected", { sessionID, userMessageID })
      })
    } catch {
      // the inspector must never affect the response
    }
  }

  const notify = async (toast: Toast) => {
    try {
      await client.tui.showToast({ body: toast })
    } catch {
      // toasts are best effort, `opencode run` has no TUI subscriber
    }
  }

  const clearTurn = (sessionID: string, userMessageID: string) => {
    const key = `${sessionID}:${userMessageID}`
    pending.delete(key)
    attempts.delete(key)
  }

  const performRetry = async (sessionID: string, userMessageID: string, attempt: number) => {
    let messages: unknown
    try {
      const response = await client.session.messages({ path: { id: sessionID } })
      if (response.error) throw new Error(JSON.stringify(response.error))
      messages = response.data
    } catch {
      logEvent("retry-dropped", { sessionID, userMessageID, attempt, retries: settings.retries })
      clearTurn(sessionID, userMessageID)
      return
    }

    const list = Array.isArray(messages) ? messages : []
    const infoOf = (bundle: unknown) => record(record(bundle)?.info)
    const userMessage = list.find((bundle) => {
      const info = infoOf(bundle)
      return info?.role === "user" && info.id === userMessageID
    })
    const assistantMessages = list.filter((bundle) => {
      const info = infoOf(bundle)
      return info?.role === "assistant" && info.parentID === userMessageID
    })
    const assistantMessage = assistantMessages[assistantMessages.length - 1]

    if (!userMessage || !assistantMessage) {
      logEvent("retry-dropped", { sessionID, userMessageID, attempt, retries: settings.retries })
      clearTurn(sessionID, userMessageID)
      return
    }

    const info = infoOf(userMessage)!
    const parts: PromptPart[] = toPromptParts(record(userMessage)?.parts)
    if (parts.length === 0) {
      logEvent("retry-dropped", { sessionID, userMessageID, attempt, retries: settings.retries })
      clearTurn(sessionID, userMessageID)
      return
    }

    const assistantID = infoOf(assistantMessage)!.id
    const model = record(info.model)
    const variant = typeof model?.variant === "string" ? model.variant : undefined

    logEvent("retry-started", { sessionID, userMessageID, attempt, retries: settings.retries })
    await notify(toastFor("attempt", attempt, settings.retries))

    try {
      const reverted = await client.session.revert({
        path: { id: sessionID },
        body: { messageID: String(assistantID) },
      })
      if (reverted.error) throw new Error(JSON.stringify(reverted.error))

      const prompted = await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          messageID: userMessageID,
          parts,
          agent: typeof info.agent === "string" ? info.agent : undefined,
          model: model ? { providerID: String(model.providerID), modelID: String(model.modelID) } : undefined,
          variant,
        } as never,
      })
      if (prompted.error) throw new Error(JSON.stringify(prompted.error))
    } catch {
      logEvent("retry-failed", { sessionID, userMessageID, attempt, retries: settings.retries })
      clearTurn(sessionID, userMessageID)
      return
    }

    attempts.set(`${sessionID}:${userMessageID}`, attempt)
    pending.delete(`${sessionID}:${userMessageID}`)
  }

  const onIdle = async (sessionID: string) => {
    const prefix = sessionPrefix(sessionID)
    for (const key of [...attempts.keys()]) {
      if (key.startsWith(prefix) && !pending.has(key)) attempts.delete(key)
    }

    const keys = [...pending].filter((key) => key.startsWith(prefix))
    if (keys.length === 0) return
    const selected = keys[keys.length - 1]!
    const userMessageID = selected.slice(prefix.length)

    let parentID: string | undefined
    try {
      const response = await client.session.get({ path: { id: sessionID } })
      const parent = record(response.data)?.parentID
      parentID = typeof parent === "string" ? parent : undefined
    } catch {
      parentID = undefined
    }

    const knownAttempts = attempts.get(selected) ?? 0
    const decision = decideIdle({ pending: keys, attempts, retries: settings.retries, parentID })

    if (decision.kind === "skip-child") {
      logEvent("child-session-skipped", { sessionID, userMessageID })
      for (const key of keys) pending.delete(key)
      return
    }

    if (decision.kind === "give-up") {
      logEvent("exhausted", {
        sessionID,
        userMessageID,
        attempt: knownAttempts,
        retries: settings.retries,
      })
      await notify(toastFor("exhausted", knownAttempts, settings.retries))
      for (const key of keys) {
        pending.delete(key)
        attempts.delete(key)
      }
      return
    }

    if (decision.kind === "retry") {
      await performRetry(sessionID, userMessageID, decision.attempt)
    }
  }

  return {
    config: async (config) => {
      const providers = record(config.provider)
      const providerOptions = record(record(providers?.[settings.provider])?.options)
      if (!providerOptions) {
        logEvent("provider-missing", { provider: settings.provider })
        return
      }

      const current = providerOptions.fetch
      if (typeof current === "function" && (current as unknown as RecordValue)[WRAPPER_MARKER] === true) return

      const upstream: FetchLike = typeof current === "function" ? (current as FetchLike) : fetch
      const wrapped: FetchLike = async (input, init) => {
        const response = await upstream(input, init)
        inspect(response, requestHeaders(input, init))
        return response
      }
      Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true })
      providerOptions.fetch = wrapped
    },

    "chat.headers": async (input, output) => {
      if (providerIdOf(input.provider) !== settings.provider) return
      const messageID = record(input.message)?.id
      if (typeof messageID !== "string" || !messageID) return
      output.headers[REQUEST_HEADER] = messageID
    },

    event: async ({ event }) => {
      const data = record(event)
      if (data?.type !== "session.idle") return
      const sessionID = record(data.properties)?.sessionID
      if (typeof sessionID !== "string" || !sessionID) return
      try {
        await onIdle(sessionID)
      } catch {
        // idle handling is best effort
      }
    },
  }
}
