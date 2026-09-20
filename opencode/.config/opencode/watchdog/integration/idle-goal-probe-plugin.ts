/// <reference path="../../explore-controls/bun-shims.d.ts" />

import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync } from "node:fs"
import { classifyUserMessage, type ClassifiableUserMessage } from "../../plugin-generated-user/helpers"
import { loadUserClassifierConfig } from "../../plugin-generated-user/config"
import { buildIdleAdvisory, watchdogMetadata } from "../prompt"

const debug = (message: string) => {
  const path = process.env.WATCHDOG_IDLE_PROBE_DEBUG
  if (!path) return
  try {
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // probe diagnostics only
  }
}

type MessageLike = { info?: { role?: unknown; id?: unknown; agent?: unknown; model?: unknown }; parts?: unknown }

export const IdleGoalProbePlugin: Plugin = async ({ client }) => {
  const patterns = loadUserClassifierConfig().patterns.patterns
  const settleMs = Number.parseInt(process.env.WATCHDOG_IDLE_PROBE_SETTLE_MS ?? "300", 10)
  const promptLimit = Number.parseInt(process.env.WATCHDOG_IDLE_PROBE_PROMPT_LIMIT ?? "1", 10)

  const admissions = new Map<string, { generation: number; timer: ReturnType<typeof setTimeout> }>()
  const promptCount = new Map<string, number>()
  let cancelled = 0
  let prompted = 0

  const stats = () => ({
    cancelled,
    prompted,
    admissions: admissions.size,
  })

  const cancel = (sessionID: string, reason: string) => {
    const admission = admissions.get(sessionID)
    if (!admission) return
    clearTimeout(admission.timer)
    admissions.delete(sessionID)
    cancelled += 1
    debug(`cancelled session=${sessionID} reason=${reason} stats=${JSON.stringify(stats())}`)
  }

  const arm = (sessionID: string, eventName: string) => {
    const existing = admissions.get(sessionID)
    if (existing) clearTimeout(existing.timer)
    const generation = (existing?.generation ?? 0) + 1
    const timer = setTimeout(() => {
      void fire(sessionID, generation)
    }, settleMs)
    admissions.set(sessionID, { generation, timer })
    debug(`armed session=${sessionID} event=${eventName} generation=${generation} stats=${JSON.stringify(stats())}`)
  }

  const fire = async (sessionID: string, generation: number) => {
    const current = admissions.get(sessionID)
    if (!current || current.generation !== generation) return
    admissions.delete(sessionID)
    try {
      const session = await client.session.get({ path: { id: sessionID } })
      const info = session.data as { parentID?: unknown } | undefined
      if (typeof info?.parentID === "string") return

      const response = await client.session.messages({ path: { id: sessionID }, query: { limit: 20 } })
      const messages = (response.data ?? []) as MessageLike[]
      const latestUser = messages.filter((message) => message.info?.role === "user").at(-1)
      if (!latestUser) {
        debug(`suppressed session=${sessionID} reason=no-user stats=${JSON.stringify(stats())}`)
        return
      }
      const kind = classifyUserMessage(latestUser as ClassifiableUserMessage, patterns)
      if (kind.kind !== "real") {
        cancelled += 1
        debug(`suppressed session=${sessionID} reason=${kind.kind} stats=${JSON.stringify(stats())}`)
        return
      }

      const count = promptCount.get(sessionID) ?? 0
      if (count >= promptLimit) {
        debug(`suppressed session=${sessionID} reason=prompt-limit stats=${JSON.stringify(stats())}`)
        return
      }
      promptCount.set(sessionID, count + 1)
      prompted += 1
      debug(`prompting session=${sessionID} stats=${JSON.stringify(stats())}`)

      const agent = latestUser.info?.agent
      const model = latestUser.info?.model
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          ...(typeof agent === "string" ? { agent } : {}),
          ...(model && typeof model === "object" ? { model: model as { providerID: string; modelID: string } } : {}),
          parts: [
            {
              type: "text",
              text: buildIdleAdvisory(`probe root prompt ${count + 1}`),
              metadata: watchdogMetadata({ findingHash: "probe", turnEpoch: 1 }),
            },
          ],
        },
      })
      debug(`prompt-complete session=${sessionID} stats=${JSON.stringify(stats())}`)
    } catch (error) {
      debug(`fire-error session=${sessionID} error=${String(error)} stats=${JSON.stringify(stats())}`)
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = (event.properties as { sessionID?: unknown }).sessionID
        if (typeof sessionID === "string") arm(sessionID, "idle")
        return
      }
      if (event.type === "session.status") {
        const properties = event.properties as { sessionID?: unknown; status?: { type?: unknown } }
        if (properties.status?.type === "idle" && typeof properties.sessionID === "string") {
          arm(properties.sessionID, "status")
        }
        return
      }
      if (event.type === "session.deleted") {
        const info = (event.properties as { info?: { id?: unknown } }).info
        if (typeof info?.id === "string") cancel(info.id, "deleted")
      }
    },

    "chat.message": async (input, output) => {
      const kind = classifyUserMessage({ parts: output.parts }, patterns)
      if (kind.kind === "watchdog") {
        debug(`watchdog-message session=${input.sessionID}`)
        return
      }
      if (kind.kind === "foreign") {
        cancel(input.sessionID, `foreign:${kind.patternID}`)
        return
      }
      const text = output.parts
        .filter((part) => part.type === "text" && part.synthetic !== true)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")

      if (text.includes("__watchdog_probe_visible__")) {
        void client.session
          .prompt({
            path: { id: input.sessionID },
            body: {
              agent: input.agent,
              model: input.model,
              parts: [
                {
                  type: "text",
                  text: buildIdleAdvisory("visible probe advisory line"),
                  metadata: watchdogMetadata({ findingHash: "visible-probe", turnEpoch: 1 }),
                },
              ],
            },
          })
          .catch(() => {})
        return
      }

      if (text.includes("__watchdog_probe_synthetic__")) {
        void client.session
          .prompt({
            path: { id: input.sessionID },
            body: {
              agent: input.agent,
              model: input.model,
              parts: [
                {
                  type: "text",
                  text: "synthetic probe advisory line",
                  synthetic: true,
                  metadata: watchdogMetadata({ findingHash: "synthetic-probe", turnEpoch: 1 }),
                },
              ],
            },
          })
          .catch(() => {})
        return
      }

    },
  }
}
