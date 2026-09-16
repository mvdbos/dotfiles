import type { Plugin } from "@opencode-ai/plugin"
import { stripReasoningTitle } from "../async-reasoning-titles/helpers"

// Server half of the async-reasoning-titles pair. The TUI plugin
// (tui-plugins/async-reasoning-titles.ts) embeds `**Title**\n\n` into the
// persisted reasoning text and marks the part with metadata; this plugin
// removes exactly those prefixes from the outgoing request so provider
// context and prefix caches never see titles. Model-authored bold lead-ins
// have no marker and are left untouched.
export const AsyncReasoningTitlesStripPlugin: Plugin = async () => ({
  "experimental.chat.messages.transform": async (_input, output) => {
    for (const message of output.messages) {
      if (!Array.isArray(message.parts)) continue
      for (const part of message.parts) stripReasoningTitle(part)
    }
  },
})
