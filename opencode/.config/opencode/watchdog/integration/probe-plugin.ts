/// <reference path="../../explore-controls/bun-shims.d.ts" />

import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, writeFileSync } from "node:fs"
import { CriticRunner } from "../critic"
import { buildCriticAgent, parseModelRef, WATCHDOG_AGENT_NAME, type WatchdogConfig } from "../config"
import { MAX_CRITIC_OUTPUT_TOKENS } from "../prompt"

const probeDebug = (message: string) => {
  const path = process.env.WATCHDOG_PROBE_DEBUG
  if (!path) return
  try {
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // probe diagnostics only
  }
}

probeDebug("module loaded")

if (process.env.WATCHDOG_PROBE_SENTINEL) {
  try {
    writeFileSync(process.env.WATCHDOG_PROBE_SENTINEL, "loaded\n")
  } catch {
    // probe sentinel only
  }
}

export const WATCHDOG_PROBE_TRIGGER = "__watchdog_probe_run__"

export const WatchdogProbePlugin: Plugin = async ({ client }) => {
  probeDebug("factory invoked")
  void client.app
    .log({ body: { service: "watchdog-probe", level: "info", message: "probe plugin loaded" } })
    .catch(() => {})
  const criticSessions = new Set<string>()
  const modelRef = process.env.WATCHDOG_PROBE_MODEL ?? "probe/critic-model"
  const timeoutMs = Number.parseInt(process.env.WATCHDOG_PROBE_TIMEOUT_MS ?? "5000", 10)
  const minOutputTokens = Number.parseInt(process.env.WATCHDOG_PROBE_OUTPUT_TOKENS ?? String(MAX_CRITIC_OUTPUT_TOKENS), 10)

  const config: WatchdogConfig = {
    enabled: true,
    model: modelRef,
    everyTools: 10,
    onIdle: true,
    maxRecentTools: 12,
    timeoutMs,
    foreignContinuationSettleMs: 0,
    foreignContinuationPatterns: { mode: "extend", patterns: [] },
    midRunDelivery: false,
    debug: true,
  }
  const agent = buildCriticAgent(config)
  const runner = new CriticRunner({
    client: client as never,
    onChildCreated: (id) => criticSessions.add(id),
    onChildDisposed: (id) => criticSessions.delete(id),
  })

  return {
    config: async (input) => {
      input.agent = { ...(input.agent ?? {}), [WATCHDOG_AGENT_NAME]: agent }
    },

    "chat.params": async (input, output) => {
      if (input.agent !== WATCHDOG_AGENT_NAME) return
      if (!criticSessions.has(input.sessionID)) return
      output.maxOutputTokens = minOutputTokens
    },

    "chat.message": async (input, output) => {
      probeDebug(`chat.message session=${input.sessionID} parts=${output.parts.length}`)
      const text = output.parts
        .filter((part) => part.type === "text" && part.synthetic !== true)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
      if (!text.includes(WATCHDOG_PROBE_TRIGGER)) return
      probeDebug("trigger accepted")
      void client.app
        .log({ body: { service: "watchdog-probe", level: "info", message: "probe trigger accepted" } })
        .catch(() => {})

      void runner
        .run({
          rootSessionID: input.sessionID,
          agent: WATCHDOG_AGENT_NAME,
          model: parseModelRef(modelRef),
          prompt: "probe packet",
          minimalPrompt: "minimal probe packet",
          timeoutMs,
        })
        .then((result) => probeDebug(`runner result ${result.kind}`))
        .catch((error) => probeDebug(`runner threw ${String(error)}`))
    },
  }
}
