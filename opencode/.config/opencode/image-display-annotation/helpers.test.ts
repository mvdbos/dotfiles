import { describe, expect, test } from "bun:test"
import {
  ANNOTATION_MARKER,
  annotateDisplayedImages,
  displayAnnotation,
  displayedImagePaths,
  stripDisplayAnnotations,
} from "./helpers"

describe("image display annotation helpers", () => {
  test("appends one marker line per path", () => {
    const text = annotateDisplayedImages("Done.", ["/a.png", "/b c.jpg"])
    expect(text).toBe(
      `Done.${displayAnnotation("/a.png")}${displayAnnotation("/b c.jpg")}`,
    )
    expect(text).toContain(ANNOTATION_MARKER)
  })

  test("keeps the text unchanged without paths", () => {
    expect(annotateDisplayedImages("Done.", [])).toBe("Done.")
  })

  test("trails the marker on the annotation line", () => {
    // Leading zero-width characters make OpenTUI's streaming markdown renderer
    // drop a visible character at the line end or soft wrap seam.
    const annotation = displayAnnotation("/a.png")
    expect(annotation.endsWith(ANNOTATION_MARKER)).toBe(true)
    for (const line of annotation.split("\n")) {
      expect(line.startsWith(ANNOTATION_MARKER)).toBe(false)
    }
  })

  test("strips only marker-carrying annotations", () => {
    const modelAuthored = "Look at Displayed image: /not-a-real-annotation.png for context."
    const annotated = annotateDisplayedImages("Done.", ["/a.png"])
    const text = annotateDisplayedImages(`${annotated}\n\n${modelAuthored}`, ["/b.png"])

    expect(stripDisplayAnnotations(text)).toBe(`Done.\n\n${modelAuthored}`)
  })

  test("prefers the metadata paths", () => {
    expect(displayedImagePaths("image_display", "Displayed image: /output.png", { paths: ["/a.png", "/b.png"] })).toEqual([
      "/a.png",
      "/b.png",
    ])
  })

  test("accepts the legacy single metadata path", () => {
    expect(displayedImagePaths("image_display", "Displayed image: /output.png", { path: "/meta.png" })).toEqual([
      "/meta.png",
    ])
  })

  test("falls back to every output line", () => {
    expect(displayedImagePaths("image_display", "Displayed image: /a.png\nDisplayed image: /b c.png", {})).toEqual([
      "/a.png",
      "/b c.png",
    ])
  })

  test("rejects other tools and failed displays", () => {
    expect(displayedImagePaths("bash", "Displayed image: /out.png", { paths: ["/meta.png"] })).toEqual([])
    expect(displayedImagePaths("image_display", "Image not found: /missing.png", {})).toEqual([])
    expect(displayedImagePaths("image_display", "Dismissed displayed image", {})).toEqual([])
    expect(displayedImagePaths("image_display", undefined, {})).toEqual([])
    expect(displayedImagePaths("image_display", "Displayed image: ", { path: "" })).toEqual([])
  })
})
