/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import {
  assistantCompleted,
  createSession,
  messages,
  OPENCODE_BIN,
  promptAsync,
  reasoningParts,
  startTui,
  waitFor,
} from "./harness"
import { cleanupLive, startLiveInstance, type LiveInstance } from "./live-harness"

// Live runs use the real config/auth from the user's environment. Main model
// defaults to DeepSeek V4.1 Flash, which reasons visibly (no provider summary
// titles), so every completed block is a title candidate. Titles use the model
// pinned in the real `tui.json` plugin options; without one the plugin stays off.
const enabled = process.env.ASYNC_REASONING_TITLES_LIVE === "1"
const maybe = enabled && existsSync(OPENCODE_BIN) ? test : test.skip

const main = {
  providerID: process.env.ASYNC_REASONING_TITLES_MAIN_PROVIDER ?? "deepseek",
  modelID: process.env.ASYNC_REASONING_TITLES_MAIN_MODEL ?? "deepseek-flash",
}

const PROMPT =
  "Think step by step before answering: How many minutes are in 3.5 days? End your reply with the number."

let booting: Promise<LiveInstance> | undefined
function instance(): Promise<LiveInstance> {
  booting ??= (async () => {
    const live = await startLiveInstance(main)
    await startTui(live, live.env)
    return live
  })()
  return booting
}

afterAll(async () => {
  await cleanupLive(await booting)
})

describe("live reasoning titles", () => {
  maybe(
    "titles a visibly-reasoning main model with the configured small model",
    async () => {
      const live = await instance()
      const sessionID = await createSession(live, "live titles")
      await promptAsync(live, sessionID, PROMPT, main)

      await waitFor(
        "live main response to complete",
        async () => (assistantCompleted(await messages(live, sessionID)) ? true : undefined),
        180_000,
      )

      const part = await waitFor(
        "live reasoning block to gain a generated title",
        async () => {
          const list = await messages(live, sessionID)
          return reasoningParts(list).find(
            (candidate) => typeof candidate.text === "string" && /^\*\*[^*\n]+\*\*\n\n/.test(candidate.text),
          )
        },
        180_000,
      )

      const match = String(part.text).match(/^\*\*([^*\n]+)\*\*\n\n([\s\S]+)$/)
      expect(match).not.toBeNull()
      expect(match![1]!.trim().length).toBeGreaterThan(0)
      expect(match![2]!.trim().length).toBeGreaterThan(0)
    },
    600_000,
  )
})
