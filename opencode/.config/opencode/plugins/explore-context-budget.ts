import type { Plugin } from "@opencode-ai/plugin"
import {
  FINAL_SUMMARY_INSTRUCTION,
  InvocationBudgetStore,
  type ModelLimitInfo,
  type RequestMaterial,
  estimateRequest,
  resolveModelBudget,
} from "../explore-controls/context-budget"

const EXPLORE_AGENT = "explore"

type RecordValue = Record<string, unknown>
type MessageBundle = { info?: unknown; parts?: unknown }

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null ? (value as RecordValue) : undefined
}

function sessionIDFromMessage(value: unknown) {
  const info = record(record(value)?.info)
  return typeof info?.sessionID === "string" ? info.sessionID : undefined
}

function agentFromMessage(value: unknown) {
  const info = record(record(value)?.info)
  if (typeof info?.agent === "string") return info.agent
  return typeof info?.mode === "string" ? info.mode : undefined
}

function latestUsage(messages: unknown) {
  if (!Array.isArray(messages)) return undefined
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = record(messages[messageIndex])
    const parts = message?.parts
    if (Array.isArray(parts)) {
      for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
        const part = record(parts[partIndex])
        const tokens = record(part?.tokens)
        if (part?.type === "step-finish" && typeof tokens?.input === "number") {
          return { input: tokens.input, cache: record(tokens.cache) }
        }
      }
    }
    const info = record(message?.info)
    const tokens = record(info?.tokens)
    if (info?.role === "assistant" && typeof tokens?.input === "number") {
      return { input: tokens.input, cache: record(tokens.cache) }
    }
  }
  return undefined
}

function sessionIDFromEvent(event: unknown) {
  const properties = record(record(event)?.properties)
  if (typeof properties?.sessionID === "string") return properties.sessionID
  const info = record(properties?.info)
  return typeof info?.id === "string" ? info.id : undefined
}

export const ExploreContextBudgetPlugin: Plugin = async () => {
  const store = new InvocationBudgetStore()
  const exploreSessions = new Set<string>()
  const messagesBySession = new Map<string, unknown>()
  const outputTokensBySession = new Map<string, number>()
  const unknownLimitLogged = new Set<string>()

  const finish = (sessionID: string) => {
    store.finish(sessionID)
    exploreSessions.delete(sessionID)
    messagesBySession.delete(sessionID)
    outputTokensBySession.delete(sessionID)
    unknownLimitLogged.delete(sessionID)
  }

  const rememberMessages = (messages: unknown) => {
    if (!Array.isArray(messages)) return
    for (const message of messages) {
      const sessionID = sessionIDFromMessage(message)
      if (!sessionID) continue
      messagesBySession.set(sessionID, messages)
      if (agentFromMessage(message) === EXPLORE_AGENT) exploreSessions.add(sessionID)
    }
  }

  return {
    "chat.message": async (
      input: { sessionID: string; agent?: string },
      output: { message: { agent?: string } },
    ) => {
      const agent = input.agent ?? output.message.agent
      if (agent === EXPLORE_AGENT) exploreSessions.add(input.sessionID)
    },

    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { messages: MessageBundle[] },
    ) => {
      rememberMessages(output.messages)
    },

    "chat.params": async (
      input: { sessionID: string; agent: string },
      output: { maxOutputTokens: number | undefined },
    ) => {
      if (input.agent !== EXPLORE_AGENT) return
      exploreSessions.add(input.sessionID)
      if (typeof output.maxOutputTokens === "number" && output.maxOutputTokens > 0)
        outputTokensBySession.set(input.sessionID, output.maxOutputTokens)
    },

    "experimental.chat.system.transform": async (
      input: { sessionID?: string; model: ModelLimitInfo },
      output: { system: string[] },
    ) => {
      const sessionID = input.sessionID
      if (!sessionID || !exploreSessions.has(sessionID)) return

      const budget = resolveModelBudget(input.model, {
        effectiveOutputTokens: outputTokensBySession.get(sessionID),
      })
      if (!budget.enabled && !unknownLimitLogged.has(sessionID)) {
        unknownLimitLogged.add(sessionID)
        console.warn(`[explore-context] guard disabled for ${sessionID}: ${budget.reason}`)
      }

      const material: RequestMaterial = {
        system: output.system,
        messages: messagesBySession.get(sessionID),
        providerUsage: latestUsage(messagesBySession.get(sessionID)),
      }
      const status = store.observe(sessionID, budget, estimateRequest(material))
      if (status === "exhausted" && !output.system.includes(FINAL_SUMMARY_INSTRUCTION)) {
        output.system.push(FINAL_SUMMARY_INSTRUCTION)
        store.markSummaryInjected(sessionID)
      }
    },

    "tool.execute.before": async (input: { sessionID: string }) => {
      if (!store.isExhausted(input.sessionID)) return
      throw new Error(
        "Exploration context budget exhausted. Do not call another tool; return the required final partial-results summary now.",
      )
    },

    event: async ({ event }: { event: unknown }) => {
      const sessionID = sessionIDFromEvent(event)
      if (!sessionID) return
      const type = record(event)?.type
      if (type === "session.idle" || type === "session.error" || type === "session.deleted") finish(sessionID)
    },
  }
}
