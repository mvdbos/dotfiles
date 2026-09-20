import type { Plugin } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { loadTodoReconcileConfig } from "./config"
import { isPluginSnapshotPart } from "./snapshot"
import {
  createTodoReconcileHooks,
  readTodosThroughClient,
  type MessageWithParts,
  type PersistSnapshotInput,
} from "./lifecycle"

/**
 * OpenCode fires `chat.message` for this noReply write with only the supplied
 * parts. Resend the target's existing text parts verbatim (same IDs, flags, and
 * metadata) so hooks that classify or record the turn see the same payload the
 * original prompt produced; watchdog's foreign-continuation state depends on
 * that classification, and a synthetic-only payload would look like an empty
 * real turn. Non-text parts are omitted so the server does not re-resolve files
 * or tools, and prior plugin snapshots are omitted so retries cannot duplicate.
 */
export function mirrorTextParts(target: MessageWithParts): Array<Extract<Part, { type: "text" }>> {
  return target.parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !isPluginSnapshotPart(part))
    .map((part) => ({ ...part }))
}

export const TodoReconcilePlugin: Plugin = async ({ client }) => {
  const log = (message: string, detail?: unknown) => {
    void client.app
      .log({
        body: {
          service: "todo-reconcile",
          level: "warn",
          message,
          extra: detail === undefined ? undefined : { detail },
        },
      })
      .catch(() => {})
  }

  const config = loadTodoReconcileConfig()
  for (const warning of config.warnings) log(warning)

  const persistSnapshot = async (input: PersistSnapshotInput) => {
    try {
      const target = input.target
      if (target.info.role !== "user") return { ok: false as const, reason: "snapshot target was not a user message" }
      if (target.parts.some((part) => part.type === "compaction")) {
        return { ok: false as const, reason: "compaction messages are not durable snapshot targets" }
      }
      // Stored messages nest variant in model; prompt requests take it at the top level.
      const model = target.info.model as UserMessage["model"]
      const response = await client.session.prompt({
        path: { id: input.sessionID },
        body: {
          messageID: target.info.id,
          agent: target.info.agent,
          model: target.info.model,
          ...(model.variant !== undefined ? { variant: model.variant } : {}),
          noReply: true,
          ...(target.info.system !== undefined ? { system: target.info.system } : {}),
          ...(target.info.tools !== undefined ? { tools: target.info.tools } : {}),
          parts: [
            ...mirrorTextParts(target),
            {
              id: input.partID,
              type: "text",
              text: input.text,
              synthetic: true,
              metadata: input.metadata,
            },
          ],
        },
      })
      if (response.error || !response.data) {
        return { ok: false as const, reason: describeError(response.error) }
      }
      const part = response.data.parts.find(
        (candidate): candidate is Extract<(typeof response.data.parts)[number], { type: "text" }> =>
          candidate.type === "text" && candidate.id === input.partID,
      )
      if (!part) return { ok: false as const, reason: "persisted snapshot part was not returned" }
      return { ok: true as const, part }
    } catch (error) {
      return { ok: false as const, reason: describeError(error) }
    }
  }

  return createTodoReconcileHooks({
    readTodos: (sessionID) => readTodosThroughClient(client, sessionID),
    persistSnapshot,
    nudge: config.nudge,
    log,
  })
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "unknown error"
}
