import type { Plugin } from "@opencode-ai/plugin"
import { annotateDisplayedImages, displayedImagePaths, stripDisplayAnnotations } from "../image-display-annotation/helpers"

// Transcript half of the image preview feature. Successful `image_display`
// calls queue their resolved paths; the next assistant text part that completes
// gets one marker-suffixed "Displayed image: <path>" line per image appended,
// so the paths are visible even when the TUI hides completed tool calls. The server-side
// half of the async-reasoning-titles pattern applies: the marker-verified
// annotation is stored in the transcript but stripped from outgoing provider
// requests by `experimental.chat.messages.transform`, so provider context and
// prefix caches never see it. Both halves live in this one plugin, so no part
// metadata channel is needed to verify the text.
export const ImageDisplayAnnotationPlugin: Plugin = async () => {
  const pending = new Map<string, string[]>()

  return {
    // A new user message ends any turn that never produced a final text part.
    "chat.message": async (input) => {
      pending.delete(input.sessionID)
    },
    "tool.execute.after": async (input, output) => {
      const displayed = displayedImagePaths(input.tool, output.output, output.metadata)
      if (!displayed.length) return
      const paths = pending.get(input.sessionID)
      if (paths) paths.push(...displayed)
      else pending.set(input.sessionID, [...displayed])
    },
    "experimental.text.complete": async (input, output) => {
      const paths = pending.get(input.sessionID)
      if (!paths?.length) return
      pending.delete(input.sessionID)
      output.text = annotateDisplayedImages(output.text, paths)
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const message of output.messages) {
        if (!Array.isArray(message.parts)) continue
        for (const part of message.parts) {
          if (part.type !== "text" || typeof part.text !== "string") continue
          part.text = stripDisplayAnnotations(part.text)
        }
      }
    },
  }
}
