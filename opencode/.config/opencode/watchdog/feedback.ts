import { WATCHDOG_ADVISORY_HEADER } from "../plugin-generated-user/helpers"
import { buildIdleAdvisory, buildRunAdvisory, watchdogMetadata } from "./prompt"

export const MAX_ADVISORY_TRAILER_BYTES = 1_024
const TRUNCATED_SUFFIX = "\n[truncated]"

function truncateUtf8(value: string, maxBytes: number, suffix: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).byteLength <= maxBytes) return value
  const suffixBytes = encoder.encode(suffix).byteLength
  let result = ""
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > maxBytes - suffixBytes) break
    result += character
  }
  return result + suffix
}

export function appendRunAdvisory(
  output: string,
  message: string,
  maxBytes = MAX_ADVISORY_TRAILER_BYTES,
): { output: string; trailer: string } {
  const trailer = truncateUtf8(`\n\n${buildRunAdvisory(message)}`, maxBytes, TRUNCATED_SUFFIX)
  return { output: output + trailer, trailer }
}

export type IdlePromptBody = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  parts: Array<{ type: "text"; text: string; metadata: Record<string, unknown> }>
}

export function buildIdlePromptBody(input: {
  message: string
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  findingHash: string
  turnEpoch: number
}): IdlePromptBody {
  return {
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    parts: [
      {
        type: "text",
        text: buildIdleAdvisory(input.message),
        metadata: watchdogMetadata({ findingHash: input.findingHash, turnEpoch: input.turnEpoch }),
      },
    ],
  }
}

export function isWatchdogAdvisoryText(text: string): boolean {
  return text.startsWith(WATCHDOG_ADVISORY_HEADER)
}
