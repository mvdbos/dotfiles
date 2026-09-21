import { describe, expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import { ImageDisplayAnnotationPlugin } from "../plugins/image-display-annotation"
import { ANNOTATION_MARKER, displayAnnotation } from "./helpers"

type TextPart = { type: string; text?: string }

async function hooks(): Promise<Hooks> {
  return ImageDisplayAnnotationPlugin({} as never)
}

async function afterTool(
  instance: Hooks,
  input: { tool: string; sessionID: string },
  output: { output: string; metadata?: unknown },
): Promise<void> {
  await instance["tool.execute.after"]?.(
    { ...input, callID: "call_1", args: {} },
    { title: "", output: output.output, metadata: output.metadata ?? {} },
  )
}

async function completeText(instance: Hooks, sessionID: string, text: string): Promise<string> {
  const output = { text }
  await instance["experimental.text.complete"]?.({ sessionID, messageID: "msg_1", partID: "prt_1" }, output)
  return output.text
}

async function transform(instance: Hooks, messages: Array<{ parts: TextPart[] }>): Promise<void> {
  await instance["experimental.chat.messages.transform"]?.({}, { messages: messages as never })
}

function displayOutput(...paths: string[]): { output: string; metadata: unknown } {
  return {
    output: paths.map((path) => `Displayed image: ${path}`).join("\n"),
    metadata: { paths, formats: paths.map(() => "png") },
  }
}

describe("image display annotation plugin", () => {
  test("annotates the text part that completes after a display", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/a.png"))

    expect(await completeText(instance, "s1", "Done.")).toBe(`Done.${displayAnnotation("/a.png")}`)
  })

  test("annotates with every path displayed since the last text", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/a.png"))
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/b.png"))

    expect(await completeText(instance, "s1", "Here they are.")).toBe(
      `Here they are.${displayAnnotation("/a.png")}${displayAnnotation("/b.png")}`,
    )
  })

  test("annotates every path of a grouped display in order", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/a.png", "/b.png"))

    expect(await completeText(instance, "s1", "Contact sheet.")).toBe(
      `Contact sheet.${displayAnnotation("/a.png")}${displayAnnotation("/b.png")}`,
    )
  })

  test("only annotates the first text that completes after a display", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/a.png"))
    await completeText(instance, "s1", "First.")

    expect(await completeText(instance, "s1", "Second.")).toBe("Second.")
  })

  test("ignores failed displays, other tools, and other sessions", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, { output: "Image not found: /x.png" })
    await afterTool(instance, { tool: "image_dismiss", sessionID: "s1" }, { output: "Dismissed displayed image" })
    await afterTool(instance, { tool: "image_display", sessionID: "s2" }, displayOutput("/a.png"))

    expect(await completeText(instance, "s1", "Nothing to show.")).toBe("Nothing to show.")
    expect(await completeText(instance, "s2", "Done.")).toBe(`Done.${displayAnnotation("/a.png")}`)
  })

  test("a new user message clears a pending annotation", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/a.png"))
    await instance["chat.message"]?.({ sessionID: "s1" }, { message: {} as never, parts: [] })

    expect(await completeText(instance, "s1", "Next turn.")).toBe("Next turn.")
  })

  test("strips marker-carrying annotations from outgoing text parts", async () => {
    const instance = await hooks()
    await afterTool(instance, { tool: "image_display", sessionID: "s1" }, displayOutput("/a.png"))
    const annotated = await completeText(instance, "s1", "Done.")
    const modelAuthored = { type: "text", text: "Displayed image: /model-authored.png" }
    const reasoning = { type: "reasoning", text: `Kept ${ANNOTATION_MARKER}` }
    const messages = [{ parts: [{ type: "text", text: annotated }, modelAuthored, reasoning] }]

    await transform(instance, messages)

    expect(messages[0]!.parts[0]!.text).toBe("Done.")
    expect(modelAuthored.text).toBe("Displayed image: /model-authored.png")
    expect(reasoning.text).toBe(`Kept ${ANNOTATION_MARKER}`)
  })

  test("survives parts without text and messages without parts", async () => {
    const instance = await hooks()
    const messages = [{ parts: [{ type: "text" }, { type: "tool" }] }, { parts: undefined }] as unknown as Array<{
      parts: TextPart[]
    }>

    await transform(instance, messages)

    expect(messages[0]!.parts[0]!.text).toBeUndefined()
  })
})
