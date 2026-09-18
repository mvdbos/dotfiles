import type { Plugin } from "@opencode-ai/plugin"
import { loadUserClassifierConfig } from "../plugin-generated-user/config"
import { loadWatchdogConfig } from "../watchdog/config"
import { createWatchdogHooks, WatchdogRuntime, type WatchdogClient } from "../watchdog/plugin"
import { ExploreGate, WatchdogLease } from "../watchdog/scheduler"

export const WatchdogPlugin: Plugin = async ({ client }) => {
  const loaded = loadWatchdogConfig()
  const classifier = loadUserClassifierConfig()
  const sdk = client as unknown as WatchdogClient
  const log = (message: string, detail?: unknown) => {
    const fallback = () => console.warn(`[watchdog] ${message}`, detail ?? "")
    const appLog = sdk?.app?.log
    if (!appLog) {
      fallback()
      return
    }
    void appLog
      .call(sdk.app, {
        body: {
          service: "watchdog",
          level: "warn",
          message,
          extra: detail === undefined ? undefined : { detail: String(detail) },
        },
      })
      .catch(fallback)
  }

  if (!loaded.enabled) {
    if (loaded.disabledReason) log(loaded.disabledReason)
    return {}
  }

  for (const warning of [...loaded.warnings, ...classifier.warnings]) log(warning)

  const runtime = new WatchdogRuntime({
    client: sdk,
    config: loaded.config,
    patterns: classifier.patterns.patterns,
    lease: new WatchdogLease(),
    explore: new ExploreGate(),
    log,
  })

  return createWatchdogHooks(runtime)
}
