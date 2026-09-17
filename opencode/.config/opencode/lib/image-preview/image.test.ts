import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expandPath, ImagePreviewError, resolveImage, sniffFormat } from "./image"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-preview-test-"))
  try {
    return await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

async function failure(run: Promise<unknown>): Promise<Error> {
  return run.then(
    () => {
      throw new Error("expected rejection")
    },
    (error) => error as Error,
  )
}

describe("sniffFormat", () => {
  test("detects png, jpeg, webp, gif from magic bytes", () => {
    expect(sniffFormat(PNG)).toBe("png")
    expect(sniffFormat(JPEG)).toBe("jpeg")
    expect(sniffFormat(WEBP)).toBe("webp")
    expect(sniffFormat(GIF)).toBe("gif")
  })

  test("rejects non-images and short buffers", () => {
    expect(sniffFormat(new TextEncoder().encode("#!/bin/sh\necho hi"))).toBeNull()
    expect(sniffFormat(new Uint8Array([0x89, 0x50]))).toBeNull()
  })
})

describe("expandPath", () => {
  test("expands ~ and ~/", () => {
    expect(expandPath("~", "/cwd")).toBe(os.homedir())
    expect(expandPath("~/a.png", "/cwd")).toBe(path.join(os.homedir(), "a.png"))
  })

  test("resolves relative paths against cwd and normalizes", () => {
    expect(expandPath("a/b.png", "/cwd")).toBe(path.join("/cwd", "a/b.png"))
    expect(expandPath("./a/../b.png", "/cwd")).toBe(path.join("/cwd", "b.png"))
    expect(expandPath("/x/./y.png", "/cwd")).toBe("/x/y.png")
  })

  test("keeps spaces intact", () => {
    expect(expandPath("/tmp/my image (1).png", "/cwd")).toBe("/tmp/my image (1).png")
  })

  test("rejects empty input", () => {
    expect(() => expandPath("   ", "/cwd")).toThrow(ImagePreviewError)
  })
})

describe("resolveImage", () => {
  test("accepts real images by bytes even with wrong extension", () =>
    withTempDir(async (dir) => {
      const file = path.join(dir, "mislabelled.txt")
      await fs.writeFile(file, Buffer.from(PNG))
      const image = await resolveImage(file, dir)
      expect(image).toEqual({ path: file, format: "png" })
    }))

  test("accepts filenames with spaces and parentheses", () =>
    withTempDir(async (dir) => {
      const file = path.join(dir, "my image (1).jpeg")
      await fs.writeFile(file, Buffer.from(JPEG))
      expect((await resolveImage(file, dir)).format).toBe("jpeg")
    }))

  test("resolves relative paths against provided cwd", () =>
    withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "sub", "x.gif"), Buffer.from(GIF)).catch(async () => {
        await fs.mkdir(path.join(dir, "sub"))
        await fs.writeFile(path.join(dir, "sub", "x.gif"), Buffer.from(GIF))
      })
      expect((await resolveImage("sub/x.gif", dir)).path).toBe(path.join(dir, "sub", "x.gif"))
    }))

  test("missing path gives actionable error", () =>
    withTempDir(async (dir) => {
      const missing = path.join(dir, "nope.png")
      expect((await failure(resolveImage(missing, dir))).message).toBe(`Image not found: ${missing}`)
    }))

  test("directory is rejected", () =>
    withTempDir(async (dir) => {
      const error = await failure(resolveImage(dir, "/"))
      expect(error).toBeInstanceOf(ImagePreviewError)
      expect(error.message).toBe(`Not a regular file: ${dir}`)
    }))

  test("non-image file is rejected", () =>
    withTempDir(async (dir) => {
      const file = path.join(dir, "notes.png")
      await fs.writeFile(file, "not really a png")
      const error = await failure(resolveImage(file, dir))
      expect(error).toBeInstanceOf(ImagePreviewError)
      expect(error.message).toContain("Unsupported image format")
    }))
})
