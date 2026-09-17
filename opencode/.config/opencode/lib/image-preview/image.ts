import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type SupportedImageFormat = "png" | "jpeg" | "webp" | "gif"

export type ResolvedImage = {
  path: string
  format: SupportedImageFormat
}

export class ImagePreviewError extends Error {}

const MAGIC: Array<{ format: SupportedImageFormat; prefix: number[]; offset?: number }> = [
  { format: "png", prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: "jpeg", prefix: [0xff, 0xd8, 0xff] },
  { format: "gif", prefix: [0x47, 0x49, 0x46, 0x38] },
  { format: "webp", prefix: [0x52, 0x49, 0x46, 0x46] },
  { format: "webp", prefix: [0x57, 0x45, 0x42, 0x50], offset: 8 },
]

export function sniffFormat(bytes: Uint8Array): SupportedImageFormat | null {
  for (const { format, prefix, offset = 0 } of MAGIC) {
    if (bytes.length < offset + prefix.length) continue
    if (prefix.every((byte, index) => bytes[offset + index] === byte)) return format
  }
  return null
}

export function expandPath(input: string, cwd: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new ImagePreviewError("Image path is empty")
  let expanded = trimmed
  if (expanded === "~") expanded = os.homedir()
  else if (expanded.startsWith("~/")) expanded = path.join(os.homedir(), expanded.slice(2))
  return path.normalize(path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded))
}

export async function resolveImage(input: string, cwd: string): Promise<ResolvedImage> {
  const resolved = expandPath(input, cwd)
  let stats
  try {
    stats = await fs.stat(resolved)
  } catch {
    throw new ImagePreviewError(`Image not found: ${resolved}`)
  }
  if (!stats.isFile()) throw new ImagePreviewError(`Not a regular file: ${resolved}`)

  let handle: fs.FileHandle
  try {
    handle = await fs.open(resolved, "r")
  } catch (cause) {
    throw new ImagePreviewError(`Cannot read image: ${resolved} (${cause instanceof Error ? cause.message : String(cause)})`)
  }
  try {
    const header = new Uint8Array(16)
    const { bytesRead } = await handle.read(header, 0, 16, 0)
    const format = sniffFormat(header.subarray(0, bytesRead))
    if (!format) {
      throw new ImagePreviewError(
        `Unsupported image format: ${resolved} (detected from file bytes; supported: PNG, JPEG, WebP, GIF)`,
      )
    }
    return { path: resolved, format }
  } finally {
    await handle.close()
  }
}
