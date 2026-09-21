import { spawn } from "node:child_process"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"

const DISPLAY_TOOL = "image_display"
const DISMISS_TOOL = "image_dismiss"

// iTerm2 draws graphics behind terminal text and the bundled OpenTUI has no
// image renderable, so in-pane overlays always collide with the TUI. Show the
// images in native viewer windows instead; the resolved paths are already
// visible in the TUI as the tool title and output.
//
// macOS: Preview groups several images opened together into one window (the
// thumbnail sidebar; View > Contact Sheet turns it into a grid). Preview
// windows are real app windows, so they stay open until the user closes them;
// there is no reliable way to dismiss only our windows, and killing Preview
// would close the user's other documents.
//
// OPENCODE_IMAGE_PREVIEW_VIEWER / OPENCODE_IMAGE_PREVIEW_DISMISS override the
// viewer and dismiss commands (used by integration tests).
function viewerCommands(paths: string[]): Array<{ command: string; args: string[] }> {
  if (process.env.OPENCODE_IMAGE_PREVIEW_VIEWER) {
    return [{ command: process.env.OPENCODE_IMAGE_PREVIEW_VIEWER, args: paths }]
  }
  if (process.platform === "darwin") return [{ command: "open", args: ["-a", "Preview", ...paths] }]
  if (process.platform === "linux") return paths.map((path) => ({ command: "xdg-open", args: [path] }))
  return []
}

function dismissCommand(): { command: string; args: string[] } | undefined {
  if (process.env.OPENCODE_IMAGE_PREVIEW_DISMISS) {
    return { command: process.env.OPENCODE_IMAGE_PREVIEW_DISMISS, args: [] }
  }
  return undefined
}

function run(command: string, args: string[]): void {
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref()
  } catch {}
}

// Preferred contract: resolved paths in tool metadata. Fallback: the output
// lines of parts recorded by older versions (single path in `metadata.path`).
function resolvedPaths(part: ToolPart): string[] {
  if (part.state.status !== "completed") return []
  const metadata = part.state.metadata
  if (metadata) {
    if (Array.isArray(metadata.paths)) {
      const paths = metadata.paths.filter((path): path is string => typeof path === "string" && path.length > 0)
      if (paths.length) return paths
    }
    if (typeof metadata.path === "string" && metadata.path) return [metadata.path]
  }
  return [...part.state.output.matchAll(/^Displayed image: (.+)$/gm)]
    .map((match) => match[1]!.trim())
    .filter(Boolean)
}

const tui: TuiPlugin = async (api) => {
  let lastPartID: string | undefined

  const dismiss = () => {
    const command = dismissCommand()
    if (command) run(command.command, command.args)
  }

  const display = (paths: string[]) => {
    for (const command of viewerCommands(paths)) run(command.command, command.args)
  }

  api.event.on("message.part.updated", (event) => {
    // Never let a preview failure take down the host TUI.
    try {
      const part = event.properties.part
      if (part.type !== "tool" || part.id === lastPartID) return
      const toolPart = part as ToolPart
      if (toolPart.state.status !== "completed") return
      if (toolPart.tool === DISMISS_TOOL) {
        lastPartID = part.id
        dismiss()
        return
      }
      if (toolPart.tool !== DISPLAY_TOOL) return
      const paths = resolvedPaths(toolPart)
      if (!paths.length) return
      lastPartID = part.id
      display(paths)
    } catch {}
  })

  // Legacy v1 command API; still supported by OpenCode 1.18 (types mark it optional).
  api.command?.register(() => [
    {
      title: "Dismiss displayed image",
      value: "image_preview.dismiss",
      description: "Close the image preview panel",
      category: "Image preview",
      onSelect: () => dismiss(),
    },
  ])

  api.lifecycle.onDispose(() => {
    dismiss()
  })
}

export default {
  id: "local.image-preview",
  tui,
} satisfies TuiPluginModule & { id: string }
