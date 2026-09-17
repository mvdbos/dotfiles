import { spawn } from "node:child_process"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { ToolPart } from "@opencode-ai/sdk/v2"

const DISPLAY_TOOL = "image_display"
const DISMISS_TOOL = "image_dismiss"

// iTerm2 draws graphics behind terminal text and the bundled OpenTUI has no
// image renderable, so in-pane overlays always collide with the TUI. Show the
// image in a native Quick Look panel (ESC closes it) instead; the resolved
// path is already visible in the TUI as the tool title and output.
// OPENCODE_IMAGE_PREVIEW_VIEWER / OPENCODE_IMAGE_PREVIEW_DISMISS override the
// viewer and dismiss commands (used by integration tests).
function viewerCommand(path: string): { command: string; args: string[] } | undefined {
  if (process.env.OPENCODE_IMAGE_PREVIEW_VIEWER) {
    return { command: process.env.OPENCODE_IMAGE_PREVIEW_VIEWER, args: [path] }
  }
  if (process.platform === "darwin") return { command: "qlmanage", args: ["-p", path] }
  if (process.platform === "linux") return { command: "xdg-open", args: [path] }
  return undefined
}

function dismissCommand(): { command: string; args: string[] } | undefined {
  if (process.env.OPENCODE_IMAGE_PREVIEW_DISMISS) {
    return { command: process.env.OPENCODE_IMAGE_PREVIEW_DISMISS, args: [] }
  }
  if (process.platform === "darwin") return { command: "killall", args: ["QLManage"] }
  return undefined
}

function run(command: string, args: string[]): void {
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref()
  } catch {}
}

// Preferred contract: resolved path in tool metadata. Fallback: the output line
// of parts recorded by older versions.
function resolvedPath(part: ToolPart): string | undefined {
  if (part.state.status !== "completed") return undefined
  const metadataPath = part.state.metadata?.path
  if (typeof metadataPath === "string" && metadataPath) return metadataPath
  const match = /^Displayed image: (.+)$/m.exec(part.state.output)
  return match?.[1]?.trim() || undefined
}

const tui: TuiPlugin = async (api) => {
  let lastPartID: string | undefined

  const dismiss = () => {
    const command = dismissCommand()
    if (command) run(command.command, command.args)
  }

  const display = (path: string) => {
    const command = viewerCommand(path)
    if (command) run(command.command, command.args)
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
      const path = resolvedPath(toolPart)
      if (!path) return
      lastPartID = part.id
      display(path)
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
