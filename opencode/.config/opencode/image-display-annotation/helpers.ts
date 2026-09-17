// Pure helpers for the image display annotation plugin. The annotation is a
// "Displayed image: <abs path>" line appended to the assistant text that
// completes after a successful image_display call. A zero-width space marker
// makes the line verifiable: it is invisible in the transcript but never
// authored by the model, so the strip half can remove exactly our lines from
// outgoing provider requests.
//
// The marker trails the line on purpose. OpenTUI's streaming markdown renderer
// (0.4.5, pinned by OpenCode 1.18) computes row widths from code units, so a
// zero-width character anywhere in a paragraph shifts the seam and drops a
// visible character at the line end or soft wrap. With the marker last, the
// discarded unit is the invisible marker itself and the path renders intact.

export const ANNOTATION_MARKER = "\u200b"
export const DISPLAY_OUTPUT_PREFIX = "Displayed image: "

export function displayAnnotation(path: string): string {
  return `\n\n${DISPLAY_OUTPUT_PREFIX}${path}${ANNOTATION_MARKER}`
}

export function annotateDisplayedImages(text: string, paths: readonly string[]): string {
  let annotated = text
  for (const path of paths) annotated += displayAnnotation(path)
  return annotated
}

const ANNOTATION_PATTERN = new RegExp(`\\n\\n${DISPLAY_OUTPUT_PREFIX}[^\\n]*${ANNOTATION_MARKER}`, "g")

export function stripDisplayAnnotations(text: string): string {
  return text.replace(ANNOTATION_PATTERN, "")
}

export function displayedImagePath(tool: string, output: string | undefined, metadata: unknown): string | undefined {
  if (tool !== "image_display") return undefined
  const text = output ?? ""
  if (!text.startsWith(DISPLAY_OUTPUT_PREFIX)) return undefined
  if (typeof metadata === "object" && metadata !== null) {
    const path = (metadata as Record<string, unknown>).path
    if (typeof path === "string" && path) return path
  }
  return text.slice(DISPLAY_OUTPUT_PREFIX.length).trim() || undefined
}
