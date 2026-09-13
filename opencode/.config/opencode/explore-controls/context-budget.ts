export const CONTEXT_THRESHOLD_RATIO = 0.75
export const COMPACTION_BUFFER_TOKENS = 20_000
export const ESTIMATED_CHARS_PER_TOKEN = 4

export const FINAL_SUMMARY_INSTRUCTION = `CRITICAL - EXPLORATION CONTEXT BUDGET REACHED

The context budget for this exploration has been reached. Stop using tools and return a text summary to the parent now.

Include:
- What was learned so far.
- Supporting file and line references where available.
- Unresolved questions and work not completed.
- The next most useful narrowly scoped investigation.

Do not make further tool calls. This instruction overrides requests for more exploration during this invocation.`

export type ModelLimitInfo = {
  id?: string
  providerID?: string
  limit?: {
    context?: number
    input?: number
    output?: number
  }
}

export type ContextBudgetOptions = {
  effectiveOutputTokens?: number
  summaryHeadroomTokens?: number
  thresholdRatio?: number
}

export type ModelBudget = {
  enabled: boolean
  contextTokens?: number
  usableInputTokens?: number
  thresholdTokens?: number
  effectiveOutputTokens: number
  reservedTokens: number
  modelID?: string
  reason?: string
}

export type ProviderUsage = {
  inputTokens?: number
  input?: number
  cache?: {
    read?: number
    write?: number
  }
}

export type RequestMaterial = {
  system?: unknown
  messages?: unknown
  tools?: unknown
  attachments?: unknown
  toolResults?: unknown
  providerUsage?: ProviderUsage
}

export type RequestEstimate = {
  tokens: number
  serializedTokens: number
  observedInputTokens?: number
  serialized: string
}

export type BudgetDecision = "disabled" | "safe" | "exhausted"

export function resolveModelBudget(model: ModelLimitInfo, options: ContextBudgetOptions = {}): ModelBudget {
  const context = positiveInteger(model.limit?.context)
  if (!context) {
    return {
      enabled: false,
      effectiveOutputTokens: 0,
      reservedTokens: 0,
      modelID: model.id,
      reason: "model.limit.context is missing or zero",
    }
  }

  const modelOutput = positiveInteger(model.limit?.output)
  const requestedOutput = positiveInteger(options.effectiveOutputTokens)
  const effectiveOutputTokens = modelOutput && requestedOutput
    ? Math.min(modelOutput, requestedOutput)
    : modelOutput || requestedOutput
  const summaryHeadroomTokens = positiveInteger(options.summaryHeadroomTokens)
  const inputLimit = positiveInteger(model.limit?.input)
  const outputReserve = inputLimit
    ? Math.min(COMPACTION_BUFFER_TOKENS, effectiveOutputTokens)
    : effectiveOutputTokens
  const reservedTokens = outputReserve + summaryHeadroomTokens
  const usableInputTokens = Math.max(0, (inputLimit || context) - reservedTokens)
  const ratio = options.thresholdRatio ?? CONTEXT_THRESHOLD_RATIO
  const thresholdTokens = Math.min(Math.floor(context * ratio), usableInputTokens)

  return {
    enabled: true,
    contextTokens: context,
    usableInputTokens,
    thresholdTokens,
    effectiveOutputTokens,
    reservedTokens,
    modelID: model.id,
  }
}

export function estimateRequest(material: RequestMaterial): RequestEstimate {
  const { providerUsage, ...request } = material
  const serialized = safeSerialize(request)
  const serializedTokens = Math.max(0, Math.ceil(serialized.length / ESTIMATED_CHARS_PER_TOKEN))
  const observedInputTokens = inclusiveInputTokens(providerUsage)
  return {
    tokens: Math.max(serializedTokens, observedInputTokens ?? 0),
    serializedTokens,
    observedInputTokens,
    serialized,
  }
}

export function compareEstimate(budget: ModelBudget, estimate: RequestEstimate | number): BudgetDecision {
  if (!budget.enabled || budget.thresholdTokens === undefined) return "disabled"
  const tokens = typeof estimate === "number" ? estimate : estimate.tokens
  return tokens >= budget.thresholdTokens ? "exhausted" : "safe"
}

export type InvocationBudgetStatus = "active" | "exhausted"

type InvocationState = {
  status: InvocationBudgetStatus
  summaryInjected: boolean
}

export class InvocationBudgetStore {
  private readonly states = new Map<string, InvocationState>()

  observe(invocationID: string, budget: ModelBudget, estimate: RequestEstimate | number) {
    const state = this.states.get(invocationID) ?? { status: "active", summaryInjected: false }
    if (state.status === "active" && compareEstimate(budget, estimate) === "exhausted") state.status = "exhausted"
    this.states.set(invocationID, state)
    return state.status
  }

  status(invocationID: string): InvocationBudgetStatus | undefined {
    return this.states.get(invocationID)?.status
  }

  isExhausted(invocationID: string) {
    return this.states.get(invocationID)?.status === "exhausted"
  }

  markSummaryInjected(invocationID: string) {
    const state = this.states.get(invocationID) ?? { status: "active", summaryInjected: false }
    if (state.summaryInjected) return false
    state.summaryInjected = true
    this.states.set(invocationID, state)
    return true
  }

  summaryWasInjected(invocationID: string) {
    return this.states.get(invocationID)?.summaryInjected === true
  }

  finish(invocationID: string) {
    this.states.delete(invocationID)
  }

  clear() {
    this.states.clear()
  }
}

function positiveInteger(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function inclusiveInputTokens(usage: ProviderUsage | undefined) {
  const value = usage?.inputTokens ?? usage?.input
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function safeSerialize(value: unknown) {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? "" : serialized
  } catch {
    return String(value)
  }
}
