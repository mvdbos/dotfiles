import type { Plugin } from "@opencode-ai/plugin"
import { loadUserClassifierConfig } from "../plugin-generated-user/config"
import { loadWatchdogConfig } from "../watchdog/config"
import { createWatchdogHooks, WatchdogRuntime, type WatchdogClient } from "../watchdog/plugin"
import { ExploreGate, WatchdogLease } from "../watchdog/scheduler"

export const WatchdogPlugin: Plugin = async ({ client }) => {
  const loaded = loadWatchdogConfig()
  const classifier = loadUserClassifierConfig()
  const log = (message: string, detail?: unknown) => {
    console.warn(`[watchdog] ${message}`, detail ?? "")
  }

  for (const warning of [...loaded.warnings, ...classifier.warnings]) log(warning)

  if (!loaded.enabled) {
    log(loaded.disabledReason ?? "watchdog review disabled")
    return {}
  }

  const runtime = new WatchdogRuntime({
    client: client as unknown as WatchdogClient,
    config: loaded.config,
    patterns: classifier.patterns.patterns,
    lease: new WatchdogLease(),
    explore: new ExploreGate(),
    log,
  })

  return createWatchdogHooks(runtime)
}
