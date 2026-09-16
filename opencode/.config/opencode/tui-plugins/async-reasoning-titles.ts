import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Part, ReasoningPart } from "@opencode-ai/sdk/v2"
import {
  createScheduler,
  hasReasoningSignature,
  isCompleteReasoning,
  isEligible,
  parseModelRef,
  reasoningTitle,
  requestTitle,
  titleSettings,
  truncateSource,
  withTitle,
  withTitleMetadata,
  type ProviderLike,
  type TitleSettings,
} from "../async-reasoning-titles/helpers"

const PREFIX = "[async-reasoning-titles]"
const THINKING_KEY = "thinking_mode"
const DEFAULT_CONCURRENCY = 1
const MODE_POLL_MS = 1000

type PendingTitle = {
  title: string
  source: string
  sessionID: string
  messageID: string
  partID: string
}

type Settings = {
  enabled: boolean
  model?: string
  maxInputChars?: number
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  concurrency: number
  modePollMs: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function resolveSettings(options: Record<string, unknown> | undefined): Settings {
  const raw = record(options) ?? {}
  return {
    enabled: raw.enabled !== false,
    model: typeof raw.model === "string" ? raw.model : undefined,
    maxInputChars:
      typeof raw.maxInputChars === "number" && raw.maxInputChars > 0 ? raw.maxInputChars : undefined,
    maxTokens: typeof raw.maxTokens === "number" && raw.maxTokens > 0 ? raw.maxTokens : undefined,
    temperature: typeof raw.temperature === "number" ? raw.temperature : undefined,
    timeoutMs: typeof raw.timeoutMs === "number" && raw.timeoutMs > 0 ? raw.timeoutMs : undefined,
    concurrency: Math.max(1, Math.floor(positive(raw.concurrency, DEFAULT_CONCURRENCY))),
    modePollMs: Math.max(10, Math.floor(positive(raw.modePollMs, MODE_POLL_MS))),
  }
}

function resolveTitleSettings(api: TuiPluginApi, settings: Settings): TitleSettings | undefined {
  const model = parseModelRef(settings.model)
  if (!model) return undefined
  const provider = api.state.provider.find((item) => item.id === model.providerID) as ProviderLike | undefined
  return titleSettings(model, provider, process.env, {
    maxInputChars: settings.maxInputChars,
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
    timeoutMs: settings.timeoutMs,
  })
}

function reasoningOf(api: TuiPluginApi, messageID: string, partID: string): ReasoningPart | undefined {
  const current = api.state.part(messageID).find((item) => item.id === partID)
  return current?.type === "reasoning" ? current : undefined
}

const plugin: TuiPlugin = async (api, options) => {
  const settings = resolveSettings(options)
  const log = (event: string, fields: Record<string, unknown> = {}) => {
    console.error(`${PREFIX} ${JSON.stringify({ event, ...fields })}`)
    void api.client.app
      .log({ service: "async-reasoning-titles", level: "info", message: event, extra: fields })
      .then(undefined, () => {})
  }
  if (!settings.enabled) {
    log("disabled", { reason: "options" })
    return
  }

  const missing = new Set<string>()
  const scheduler = createScheduler({
    concurrency: settings.concurrency,
    onError(error, phase) {
      log("failed", { phase, error: error instanceof Error ? error.message : String(error) })
    },
  })

  const attempted = new Set<string>()
  const pendingTitles = new Map<string, PendingTitle>()

  // Applies a generated title once the block completes. Early titles are held
  // until `time.end` so the prefix never lands on a still-growing block.
  const flushTitle = async (key: string) => {
    const pending = pendingTitles.get(key)
    if (!pending) return
    const current = reasoningOf(api, pending.messageID, pending.partID)
    if (!current) {
      pendingTitles.delete(key)
      return
    }
    if (!current.text.startsWith(pending.source)) {
      pendingTitles.delete(key)
      return
    }
    if (hasReasoningSignature(current.metadata)) {
      pendingTitles.delete(key)
      return
    }
    if (reasoningTitle(current.text)) {
      pendingTitles.delete(key)
      return
    }
    if (!isCompleteReasoning(current)) return
    if (api.kv.get(THINKING_KEY, "hide") !== "hide") {
      pendingTitles.delete(key)
      return
    }
    pendingTitles.delete(key)
    const result = await api.client.part.update({
      sessionID: pending.sessionID,
      messageID: pending.messageID,
      partID: pending.partID,
      part: {
        ...current,
        text: withTitle(current.text, pending.title),
        metadata: withTitleMetadata(current.metadata, pending.title),
      },
    })
    if (result.error) {
      log("apply-failed", { key, error: JSON.stringify(result.error).slice(0, 300) })
      return
    }
    log("applied", { key, title: pending.title })
  }

  const consider = (part: Part, sessionID: string) => {
    if (part.type !== "reasoning") return
    const key = `${sessionID}:${part.messageID}:${part.id}`
    if (pendingTitles.has(key)) {
      void flushTitle(key)
      return
    }
    if (attempted.has(key)) return

    const mode = api.kv.get(THINKING_KEY, "hide")
    if (!isEligible(part, mode, { requireComplete: false })) return

    const titleConfig = resolveTitleSettings(api, settings)
    if (!titleConfig) {
      const modelRef = parseModelRef(settings.model)
      const reason = !modelRef ? "model-missing" : "provider-endpoint-missing"
      if (!missing.has(reason)) {
        missing.add(reason)
        log("skipped", { reason })
      }
      return
    }

    // Long blocks are titled while still streaming: once the capped prefix is
    // available it will not change, so the request can overlap the remaining
    // reasoning. Shorter blocks wait for completion as before.
    const complete = isCompleteReasoning(part)
    if (!complete && part.text.length < titleConfig.maxInputChars) return

    const source = truncateSource(part.text, titleConfig.maxInputChars)
    attempted.add(key)
    log("queued", { key, chars: source.length, complete })
    scheduler.request(key, {
      shouldStart: () => {
        const current = reasoningOf(api, part.messageID, part.id)
        if (!current) return false
        return (
          current.text.startsWith(source) &&
          isEligible(current, api.kv.get(THINKING_KEY, "hide"), { requireComplete: false })
        )
      },
      shouldApply: () => api.kv.get(THINKING_KEY, "hide") === "hide",
      generate: async (signal) => {
        const title = await requestTitle({ settings: titleConfig, text: source, signal })
        if (!title) log("generation-empty", { key })
        return title
      },
      apply: async (title) => {
        pendingTitles.set(key, {
          title,
          source,
          sessionID,
          messageID: part.messageID,
          partID: part.id,
        })
        await flushTitle(key)
      },
    })
  }

  api.event.on("message.part.updated", (event) => {
    consider(event.properties.part, event.properties.sessionID)
  })

  let lastMode = api.kv.get(THINKING_KEY, "hide")
  const modeTimer = setInterval(() => {
    const mode = api.kv.get(THINKING_KEY, "hide")
    if (mode === lastMode) return
    lastMode = mode
    if (mode === "hide") return
    if (scheduler.size === 0 && pendingTitles.size === 0) return
    log("cancelled", {
      reason: "thinking-mode-changed",
      mode,
      pending: scheduler.size,
      held: pendingTitles.size,
    })
    scheduler.stop()
    missing.clear()
    attempted.clear()
    pendingTitles.clear()
  }, settings.modePollMs)

  log("ready", { small: settings.model ?? null, concurrency: settings.concurrency })
  api.lifecycle.onDispose(() => {
    clearInterval(modeTimer)
    scheduler.stop()
  })
}

export default {
  id: "async-reasoning-titles",
  tui: plugin,
}
