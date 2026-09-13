import type { Plugin } from "@opencode-ai/plugin"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import {
  createTodoReconcileHooks,
  readTodosThroughClient,
  type PersistSnapshotInput,
} from "./lifecycle"

export const TodoReconcilePlugin: Plugin = async ({ client }) => {
  const persistSnapshot = async (input: PersistSnapshotInput) => {
    try {
      const target = input.target
      if (target.info.role !== "user") return { ok: false as const, reason: "snapshot target was not a user message" }
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
      return { ok: true as const, durable: true, part }
    } catch (error) {
      return { ok: false as const, reason: describeError(error) }
    }
  }

  return createTodoReconcileHooks({
    readTodos: (sessionID) => readTodosThroughClient(client, sessionID),
    persistSnapshot,
    log: (message, detail) => {
      console.warn(`[todo-reconcile] ${message}`, detail ?? "")
    },
  })
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "unknown error"
}
