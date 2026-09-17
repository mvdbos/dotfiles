# image-preview

Shows local images to the human user via a native preview panel, driven by the
`image_display` / `image_dismiss` tools.

## Architecture

```
agent ── image_display tool ──> title + metadata.path + "Displayed image: <abs path>" (tool call, visible in TUI)
                                     │  message.part.updated event (WS)
                                     │
                                     ├─> tui-plugins/image-preview.ts ── spawn ──> macOS: qlmanage -p <path>  (Quick Look, ESC closes)
                                     │                                            Linux: xdg-open <path>
                                     │
                                     └─> plugins/image-display-annotation.ts ── append marker line to next assistant text,
                                                                                 strip it from outgoing provider requests
```

- `tools/image.ts` — server tool adapter. Resolves and validates the path
  (`~`, relative-to-session-dir, byte-sniffed PNG/JPEG/WebP/GIF); sets the tool
  title (session-directory-relative when inside, absolute otherwise) and
  returns `{ title, output, metadata: { path, format } }`. No image bytes cross
  the wire.
- `lib/image-preview/image.ts` — pure path resolution + format sniffing.
- `tui-plugins/image-preview.ts` — listens for completed `image_display` /
  `image_dismiss` tool parts and spawns the viewer on the machine running the
  TUI (correct even when the server is remote). Reads the resolved path from
  `state.metadata.path`, falling back to parsing `state.output` for parts
  recorded by older versions. Registers the `image_preview.dismiss` palette
  command; dismisses on dispose. Viewer spawns are detached, so the order in
  which they appear is not defined.
- `plugins/image-display-annotation.ts` — appends a zero-width-space-marked
  `Displayed image: <abs path>` line to the assistant text part that completes
  after a successful display, so the path is visible in the transcript even
  when the TUI hides completed tool calls (`tool_details_visibility: false`).
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
either. iTerm2 3.6.11 has no sprite images. A native panel is the only
flicker-free option; ESC closes it natively.

`OPENCODE_IMAGE_PREVIEW_VIEWER` / `OPENCODE_IMAGE_PREVIEW_DISMISS` override
the viewer and dismiss commands (used by the integration tests; also useful
for non-default viewers).

## Verification

From this directory:

```sh
bun test ./lib/image-preview/image.test.ts                                        # 12 unit tests
bun test ./lib/image-preview/integration/preview.integration.test.ts              # 7 E2E tests (~35 s)
```

The integration suite boots a real `opencode serve` + attached TUI against a
mock OpenAI-compatible LLM and asserts: tool visibility to the agent, exact
tool outputs (absolute, relative, missing file, large image, dismiss), resolved
path in tool title/metadata, one viewer spawn per successful display with fully
resolved paths, one dismiss run, annotated assistant text with stripped
provider requests, and no TUI crash.

Manual check: run OpenCode in iTerm2, ask it to display an image; the Quick
Look panel opens; ESC closes it; palette `image_preview.dismiss` closes it too.

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

- Quick Look panels stack when several images are displayed without an
  intervening dismiss; ESC closes the front panel, dismiss closes all.
- Linux depends on a working `xdg-open` association; no ESC-close guarantee.
- The transcript annotation lands on the first assistant text part that
  completes after a display; a turn that ends without any text (interrupted, or
  tool-only output) keeps the path in the tool call only.
