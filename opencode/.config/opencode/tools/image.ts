import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { ImagePreviewError, resolveImage } from "../lib/image-preview/image"

function errorText(error: unknown): string {
  if (error instanceof ImagePreviewError) return error.message
  return `Image preview failed: ${error instanceof Error ? error.message : String(error)}`
}

async function shortPath(absolute: string, directory: string, worktree: string | undefined): Promise<string> {
  const roots = new Set<string>()
  for (const candidate of [directory, worktree]) {
    if (!candidate) continue
    const normalized = path.resolve(candidate)
    // A root like "/" would turn every path into a meaningless fragment.
    if (normalized === path.parse(normalized).root) continue
    roots.add(normalized)
    try {
      roots.add(await fs.realpath(normalized))
    } catch {}
  }
  for (const root of roots) {
    const relative = path.relative(root, absolute)
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative
  }
  return absolute
}

export const display = tool({
  description:
    "Display a local image file to the human user in the terminal. Use this when visual output such as a screenshot, generated image, plot, diagram, or UI capture should be inspected by the user. Do not call it for every image encountered; only for images the user benefits from seeing. The image opens in a native preview panel that the user closes with ESC; the image_dismiss tool or the image_preview.dismiss command closes any open panels.",
  args: {
    path: tool.schema
      .string()
      .describe("Path to the image file: absolute, relative to the session directory, or ~/... (PNG, JPEG, WebP, GIF)"),
  },
  async execute(args, context) {
    try {
      const image = await resolveImage(args.path, context.directory ?? process.cwd())
      const title = await shortPath(image.path, context.directory ?? process.cwd(), context.worktree)
      return { title, output: `Displayed image: ${image.path}`, metadata: { path: image.path, format: image.format } }
    } catch (error) {
      return errorText(error)
    }
  },
})

export const dismiss = tool({
  description:
    "Close image preview panels opened by image_display. Optional: the user can also close them with ESC or the image_preview.dismiss command.",
  args: {},
  async execute() {
    return "Dismissed displayed image"
  },
})
