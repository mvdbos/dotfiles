import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { ImagePreviewError, resolveImage, type ResolvedImage } from "../lib/image-preview/image"

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
    "Display one or more local image files to the human user. Use this when visual output such as a screenshot, generated image, plot, diagram, or UI capture should be inspected by the user. Pass an array of paths to show several images together (macOS groups them into one Preview window; Linux opens one viewer per image). Do not call it for every image encountered; only for images the user benefits from seeing. The images open in native viewer windows that the user closes manually; the image_dismiss tool closes viewers that support dismissal.",
  args: {
    path: tool.schema
      .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
      .describe(
        "Path to an image file, or an array of paths to show several images together: absolute, relative to the session directory, or ~/... (PNG, JPEG, WebP, GIF)",
      ),
  },
  async execute(args, context) {
    try {
      const inputs = Array.isArray(args.path) ? args.path : [args.path]
      if (inputs.length === 0) throw new ImagePreviewError("Image path is empty")
      const directory = context.directory ?? process.cwd()
      const images: ResolvedImage[] = []
      for (const input of inputs) images.push(await resolveImage(input, directory))
      const paths = images.map((image) => image.path)
      const titles = await Promise.all(images.map((image) => shortPath(image.path, directory, context.worktree)))
      const title = titles.length === 1 ? titles[0]! : `${titles[0]} (+${titles.length - 1} more)`
      return {
        title,
        output: paths.map((imagePath) => `Displayed image: ${imagePath}`).join("\n"),
        metadata: { paths, formats: images.map((image) => image.format) },
      }
    } catch (error) {
      return errorText(error)
    }
  },
})

export const dismiss = tool({
  description:
    "Close image preview panels opened by image_display when the native viewer supports dismissal. Optional: the user can also close viewer windows themselves (macOS Preview windows are closed manually).",
  args: {},
  async execute() {
    return "Dismissed displayed image"
  },
})
