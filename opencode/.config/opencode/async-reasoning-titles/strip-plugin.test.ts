import { describe, expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import { AsyncReasoningTitlesStripPlugin } from "../plugins/async-reasoning-titles-strip"
import { TITLE_METADATA_KEY, withTitle, withTitleMetadata } from "./helpers"

type TestPart = {
  type: string
  text?: string
  metadata?: Record<string, unknown>
}

type TestMessage = { parts: TestPart[] }

async function transform(messages: TestMessage[]): Promise<TestMessage[]> {
  const hooks: Hooks = await AsyncReasoningTitlesStripPlugin({} as never)
  const hook = hooks["experimental.chat.messages.transform"]
  expect(hook).toBeDefined()
  await hook?.({}, { messages: messages as never })
  return messages
}

function titledPart(title: string, source: string, metadata: Record<string, unknown> = {}): TestPart {
  return {
    type: "reasoning",
    text: withTitle(source, title),
    metadata: withTitleMetadata(metadata, title),
  }
}

describe("async reasoning titles strip plugin", () => {
  test("removes marker-verified titles from outgoing reasoning parts", async () => {
    const part = titledPart("Checking alignment", "Looking at the parser", { keep: true })
    await transform([{ parts: [part] }])

    expect(part.text).toBe("Looking at the parser")
    expect(part.metadata).toEqual({ keep: true })
  })

  test("leaves unmarked bold lead-ins and other part types untouched", async () => {
    const modelAuthored = { type: "reasoning", text: "**Analyzing the request**\n\nBody", metadata: {} }
    const text = { type: "text", text: "**Not a title**" }
    await transform([{ parts: [modelAuthored, text] }])

    expect(modelAuthored.text).toBe("**Analyzing the request**\n\nBody")
    expect(text.text).toBe("**Not a title**")
  })

  test("strips only marked parts across messages", async () => {
    const stripped = titledPart("Debugging timeout retries", "Root cause is retry backoff")
    const kept = { type: "reasoning", text: "**Provider title**\n\nBody" }
    const messages: TestMessage[] = [{ parts: [stripped] }, { parts: [kept] }]
    await transform(messages)

    expect(stripped.text).toBe("Root cause is retry backoff")
    expect(stripped.metadata?.[TITLE_METADATA_KEY]).toBeUndefined()
    expect(kept.text).toBe("**Provider title**\n\nBody")
  })

  test("survives messages without a parts array", async () => {
    const messages = [{ parts: undefined }] as unknown as TestMessage[]
    await expect(transform(messages)).resolves.toBeDefined()
  })
})
