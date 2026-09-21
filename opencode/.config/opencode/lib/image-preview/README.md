# image-preview

Shows local images to the human user via a native preview panel, driven by the
`image_display` / `image_dismiss` tools.

## Architecture

```
agent ── image_display tool ──> title + metadata.paths + one "Displayed image: <abs path>" line per image
                                     │  message.part.updated event (WS)
                                     │
                                     ├─> tui-plugins/image-preview.ts ── spawn ──> macOS: open -a Preview <paths...>  (one grouped window)
                                     │                                            Linux: xdg-open <path>  (one per image)
                                     │
                                     └─> plugins/image-display-annotation.ts ── append marker lines to next assistant text,
                                                                                 strip them from outgoing provider requests
```

- `tools/image.ts` — server tool adapter. Accepts one path or an array of
  paths; resolves and validates each (`~`, relative-to-session-dir,
  byte-sniffed PNG/JPEG/WebP/GIF). A display is all-or-nothing: any invalid
  path fails the call and no viewer opens. Sets the tool title
  (session-directory-relative when inside, absolute otherwise, `(+N more)` for
  grouped displays) and returns `{ title, output, metadata: { paths, formats } }`.
  No image bytes cross the wire.
- `lib/image-preview/image.ts` — pure path resolution + format sniffing.
- `tui-plugins/image-preview.ts` — listens for completed `image_display` /
  `image_dismiss` tool parts and spawns the viewer on the machine running the
  TUI (correct even when the server is remote). All paths of one display call
  are passed to a single macOS viewer, so Preview groups them into one window
  (thumbnail sidebar; View > Contact Sheet, ⌥⌘6, turns it into a grid — a
  manual toggle the plugin never sends). Linux spawns one `xdg-open` per
  image. Reads `state.metadata.paths` (legacy `metadata.path` and `state.output`
  lines still work). Registers the `image_preview.dismiss` palette command.
  Viewer spawns are detached, so the order in which they appear is not defined.
- `plugins/image-display-annotation.ts` — appends one zero-width-space-marked
  `Displayed image: <abs path>` line per displayed image (a grouped display
  annotates every path) to the assistant text part that completes after a
  successful display, so the paths are visible in the transcript even when the
  TUI hides completed tool calls (`tool_details_visibility: false`).
  The marker trails the line: OpenTUI's streaming markdown renderer (0.4.5)
  drops a visible character at the line end or wrap seam when a zero-width
  character leads the paragraph. The `experimental.chat.messages.transform`
  half strips marker-verified annotations from outgoing provider requests
  (same pattern as `async-reasoning-titles-strip.ts`); helpers live in
  `image-display-annotation/`.

Why not in-pane graphics: iTerm2 always draws kitty/inline images **behind**
terminal text, and OpenCode's TUI continuously repaints the whole screen, so
out-of-band graphics collide with the UI. The `@opentui/solid` reconciler
bundled in the OpenCode 1.18 binary has no `image` component (and the bundled
core ships no image renderable), so in-render-pass drawing is not possible
either. iTerm2 3.6.11 has no sprite images. A native window is the only
flicker-free option.

`OPENCODE_IMAGE_PREVIEW_VIEWER` replaces the viewer command and receives all
paths of one display call as its arguments; `OPENCODE_IMAGE_PREVIEW_DISMISS`
replaces the dismiss command (used by the integration tests; also useful for
non-default viewers). There is no default dismiss command on any platform:
macOS Preview windows and Linux `xdg-open` windows are closed by the user, so
`image_dismiss` is a no-op unless the override is set.

## Verification

From this directory:

```sh
bun test ./lib/image-preview/image.test.ts                                        # 12 unit tests
bun test ./lib/image-preview/integration/preview.integration.test.ts              # 7 E2E tests (~35 s)
```

The integration suite boots a real `opencode serve` + attached TUI against a
mock OpenAI-compatible LLM and asserts: tool visibility to the agent, exact
tool outputs (absolute, relative, missing file, large image, grouped display,
dismiss), resolved paths in tool title/metadata, one viewer spawn per display
with all paths of a grouped display in one spawn, one dismiss run, annotated
assistant text with stripped provider requests, and no TUI crash.

Manual check: run OpenCode in iTerm2, ask it to display an image; Preview opens
with the image; a grouped display opens one window with all images in the
sidebar (View > Contact Sheet, ⌥⌘6, for the grid). Preview windows are closed
by the user.

## OpenCode 2 migration

v2 CLI plugins (`@opencode/plugin/tui`, `Plugin.define({id, setup(context)})`,
exported as `./tui`) map 1:1 onto this design:

| 1.18 (current)            | v2                                   |
| ------------------------- | ------------------------------------ |
| `api.event.on("message.part.updated")` | `context.data.on(...)` / `context.data.listen(...)` |
| `api.command.register`    | `context.keymap.layer` with `palette: true` |
| `api.ui.toast`            | `context.ui.toast.show`              |
| `lifecycle.onDispose`     | cleanup function returned from `setup` |

The tool half is unchanged. If v2's OpenTUI exposes an `image` renderable,
in-pane rendering (e.g. in a `session.panel`) becomes possible again; the
event plumbing here carries over unchanged.

## Limitations

- macOS groups the images of one `image_display` call into one Preview window;
  separate calls open separate windows (Preview's own "Open groups of files in
  the same window" setting can override this). Contact sheet view is a manual
  View menu toggle — Preview exposes no CLI or AppleScript property for it.
- Preview windows are not closed by `image_dismiss`; the user closes them.
- Linux depends on a working `xdg-open` association and opens one viewer per
  image.
- The transcript annotation lands on the first assistant text part that
  completes after a display; a turn that ends without any text (interrupted, or
  tool-only output) keeps the paths in the tool call only.
