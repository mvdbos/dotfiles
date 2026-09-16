/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import {
  assistantCompleted,
  cleanup,
  createSession,
  messages,
  OPENCODE_BIN,
  promptAsync,
  reasoningParts,
  startInstance,
  startTui,
  waitFor,
  type Instance,
} from "./harness"

const binAvailable = existsSync(OPENCODE_BIN)
const maybe = binAvailable ? test : test.skip

let booting: Promise<Instance> | undefined
function instance(): Promise<Instance> {
  booting ??= (async () => {
    const started = await startInstance()
    await startTui(started)
    return started
  })()
  return booting
}

afterAll(async () => {
  const inst = await booting
  await cleanup(inst)
})

async function promptAndWaitForMain(inst: Instance, text: string): Promise<string> {
  const sessionID = await createSession(inst)
  await promptAsync(inst, sessionID, text)
  await waitFor("main response to complete", async () =>
    assistantCompleted(await messages(inst, sessionID)) ? true : undefined,
  )
  return sessionID
}

function titledPart(list: Awaited<ReturnType<typeof messages>>) {
  return reasoningParts(list).find((part) => typeof part.text === "string" && part.text.startsWith("**"))
}

describe("async reasoning titles", () => {
  maybe(
    "embeds a generated title for a completed untitled block",
    async () => {
      const inst = await instance()
      const before = inst.llm.requestsOf("activity").length
      const sessionID = await promptAndWaitForMain(inst, "Say something short.")

      const part = await waitFor("reasoning part to gain a title", async () => titledPart(await messages(inst, sessionID)))

      expect(part.text).toContain("**Checking pixel-grid alignment**")
      expect(part.text).toContain("Looking at the parser")
      const activity = inst.llm.requestsOf("activity")
      expect(activity.length).toBe(before + 1)
      expect(activity.at(-1)?.body.model).toBe("small-model")
    },
    180_000,
  )

  maybe(
    "does not block the main response while the summarizer is pending",
    async () => {
      const inst = await instance()
      const before = inst.llm.requestsOf("activity").length
      let release!: () => void
      inst.llm.activityHold = new Promise<void>((resolve) => {
        release = resolve
      })

      try {
        const sessionID = await promptAndWaitForMain(inst, "Say something short.")
        await waitFor("activity request to be issued", async () =>
          inst.llm.requestsOf("activity").length === before + 1 ? true : undefined,
        )

        const beforeRelease = await messages(inst, sessionID)
        expect(assistantCompleted(beforeRelease)).toBe(true)
        expect(titledPart(beforeRelease)).toBeUndefined()

        release()
        const part = await waitFor("reasoning part to gain a title", async () =>
          titledPart(await messages(inst, sessionID)),
        )
        expect(part.text).toContain("**Checking pixel-grid alignment**")
      } finally {
        release()
        inst.llm.activityHold = undefined
      }
    },
    120_000,
  )

  maybe(
    "leaves the duration-only header usable when the summarizer fails",
    async () => {
      const inst = await instance()
      const before = inst.llm.requestsOf("activity").length
      inst.llm.activityStatus = 500
      try {
        const sessionID = await promptAndWaitForMain(inst, "Say something short.")
        await waitFor("activity request to be issued", async () =>
          inst.llm.requestsOf("activity").length === before + 1 ? true : undefined,
        )
        await Bun.sleep(500)

        const list = await messages(inst, sessionID)
        expect(titledPart(list)).toBeUndefined()
        expect(reasoningParts(list).some((part) => part.text.includes("Looking at the parser"))).toBe(true)
      } finally {
        inst.llm.activityStatus = 200
      }
    },
    120_000,
  )

  maybe(
    "skips blocks that already carry a provider title",
    async () => {
      const inst = await instance()
      const before = inst.llm.requestsOf("activity").length
      inst.llm.reasoning = "**Existing provider title**\n\nLooking at the parser."
      try {
        const sessionID = await promptAndWaitForMain(inst, "Say something short.")
        await Bun.sleep(1000)

        expect(inst.llm.requestsOf("activity").length).toBe(before)
        expect(titledPart(await messages(inst, sessionID))?.text).toContain("**Existing provider title**")
      } finally {
        inst.llm.reasoning = "Looking at the parser and checking pixel-grid alignment against the snapshot."
      }
    },
    120_000,
  )
})
