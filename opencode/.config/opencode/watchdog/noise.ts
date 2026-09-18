import { createHash } from "node:crypto"
import {
  CONCERN_CATEGORIES,
  MAX_CONCERN_MESSAGE_CHARS,
  MAX_CRITIC_ASSISTANT_BYTES,
  MIN_CONCERN_MESSAGE_CHARS,
  type ConcernCategory,
  type ConcernSeverity,
} from "./prompt"

export const DUPLICATE_HISTORY_LIMIT = 32
export const DUPLICATE_COOLDOWN_TOOLS = 5

export type AcceptedConcern = {
  severity: ConcernSeverity
  category: ConcernCategory
  message: string
}

export type CriticParseResult =
  | { kind: "ok" }
  | { kind: "concern"; concern: AcceptedConcern }
  | { kind: "malformed"; reason: string }

const GENERIC_MESSAGES = new Set([
  "ok",
  "okay",
  "fine",
  "looksgood",
  "beaware",
  "becareful",
  "verify",
  "check",
  "review",
  "reconsider",
  "reconsideryourwork",
  "pleasereconsider",
  "none",
  "nothing",
  "noproblem",
  "noconcern",
  "allgood",
  "continuenormally",
  "proceed",
])

export function normalizeConcernText(message: string): string {
  return message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function isContentFreeMessage(message: string): boolean {
  const normalized = normalizeConcernText(message)
  if (!normalized) return true
  if (GENERIC_MESSAGES.has(normalized.replace(/\s/g, ""))) return true
  const tokens = normalized.split(" ")
  if (tokens.length < 4) return true
  if (!tokens.some((token) => token.length >= 5)) return true
  return false
}

export function concernIdentity(category: ConcernCategory, message: string): string {
  const normalized = normalizeConcernText(message)
  return createHash("sha256").update(`${category}\n${normalized}`).digest("hex")
}

function isSeverity(value: unknown): value is ConcernSeverity {
  return value === "warning" || value === "critical"
}

function isCategory(value: unknown): value is ConcernCategory {
  return typeof value === "string" && (CONCERN_CATEGORIES as readonly string[]).includes(value)
}

const OK_KEYS: ReadonlySet<string> = new Set(["status"])
const CONCERN_KEYS: ReadonlySet<string> = new Set(["status", "severity", "category", "message"])
const INTERNAL_ECHO_KEYS: ReadonlySet<string> = new Set(["evidenceFingerprint", "sourceEpoch"])

function unexpectedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key) && !INTERNAL_ECHO_KEYS.has(key))
}

export function parseCriticOutput(text: string): CriticParseResult {
  if (Buffer.byteLength(text, "utf8") > MAX_CRITIC_ASSISTANT_BYTES) {
    return { kind: "malformed", reason: "critic output exceeded the assistant byte budget" }
  }
  const trimmed = text.trim()
  if (!trimmed) return { kind: "malformed", reason: "empty critic output" }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { kind: "malformed", reason: "critic output was not JSON" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "malformed", reason: "critic output was not a JSON object" }
  }

  const record = parsed as Record<string, unknown>
  if (record.status === "ok") {
    if (unexpectedKeys(record, OK_KEYS).length !== 0) {
      return { kind: "malformed", reason: "ok output had extra keys" }
    }
    return { kind: "ok" }
  }

  if (record.status !== "concern") {
    return { kind: "malformed", reason: "critic status was neither ok nor concern" }
  }

  const extra = unexpectedKeys(record, CONCERN_KEYS)
  if (extra.length > 0) return { kind: "malformed", reason: `concern output had extra keys: ${extra.join(", ")}` }
  if (!isSeverity(record.severity)) return { kind: "malformed", reason: "concern severity was invalid" }
  if (!isCategory(record.category)) return { kind: "malformed", reason: "concern category was invalid" }
  if (typeof record.message !== "string") return { kind: "malformed", reason: "concern message was not a string" }

  const message = record.message.trim()
  if (message.length < MIN_CONCERN_MESSAGE_CHARS || message.length > MAX_CONCERN_MESSAGE_CHARS) {
    return { kind: "malformed", reason: "concern message length was outside the schema bounds" }
  }
  if (isContentFreeMessage(message)) {
    return { kind: "malformed", reason: "concern message carried no concrete evidence" }
  }

  return { kind: "concern", concern: { severity: record.severity, category: record.category, message } }
}

export type DeliveryBudget = {
  baseDeliveryUsed: boolean
  criticalEscalationUsed: boolean
  baseSeverity?: ConcernSeverity
}

export function newDeliveryBudget(): DeliveryBudget {
  return { baseDeliveryUsed: false, criticalEscalationUsed: false }
}

export type DeliveryDecision =
  | { deliver: true; reason: "base" | "escalation"; nextBudget: DeliveryBudget }
  | { deliver: false; reason: "duplicate" | "budget" | "cooldown"; nextBudget: DeliveryBudget }

export function decideDelivery(input: {
  budget: DeliveryBudget
  severity: ConcernSeverity
  concernHash: string
  deliveredHashes: ReadonlySet<string>
  evidenceChanged: boolean
  toolsSinceLastConcern: number
  cooldownTools?: number
}): DeliveryDecision {
  const cooldown = input.cooldownTools ?? DUPLICATE_COOLDOWN_TOOLS
  if (input.deliveredHashes.has(input.concernHash)) {
    if (!(input.toolsSinceLastConcern >= cooldown && input.evidenceChanged)) {
      return { deliver: false, reason: input.toolsSinceLastConcern < cooldown ? "cooldown" : "duplicate", nextBudget: input.budget }
    }
  }

  if (!input.budget.baseDeliveryUsed) {
    return {
      deliver: true,
      reason: "base",
      nextBudget: {
        baseDeliveryUsed: true,
        criticalEscalationUsed: input.severity === "critical",
        baseSeverity: input.severity,
      },
    }
  }

  if (input.budget.criticalEscalationUsed) {
    return { deliver: false, reason: "budget", nextBudget: input.budget }
  }

  if (input.severity === "critical" && input.budget.baseSeverity === "warning" && input.evidenceChanged) {
    return {
      deliver: true,
      reason: "escalation",
      nextBudget: { ...input.budget, criticalEscalationUsed: true },
    }
  }

  return { deliver: false, reason: "budget", nextBudget: input.budget }
}
