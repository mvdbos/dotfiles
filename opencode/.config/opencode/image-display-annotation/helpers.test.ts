import { describe, expect, test } from "bun:test"
import {
  ANNOTATION_MARKER,
  annotateDisplayedImages,
  displayAnnotation,
  displayedImagePath,
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

  test("prefers the metadata path", () => {
    expect(displayedImagePath("image_display", "Displayed image: /output.png", { path: "/meta.png" })).toBe(
      "/meta.png",
    )
  })

  test("falls back to the output line", () => {
    expect(displayedImagePath("image_display", "Displayed image: /out.png", {})).toBe("/out.png")
  })

  test("rejects other tools and failed displays", () => {
    expect(displayedImagePath("bash", "Displayed image: /out.png", { path: "/meta.png" })).toBeUndefined()
    expect(displayedImagePath("image_display", "Image not found: /missing.png", {})).toBeUndefined()
    expect(displayedImagePath("image_display", "Dismissed displayed image", {})).toBeUndefined()
    expect(displayedImagePath("image_display", undefined, {})).toBeUndefined()
    expect(displayedImagePath("image_display", "Displayed image: ", { path: "" })).toBeUndefined()
  })
})
