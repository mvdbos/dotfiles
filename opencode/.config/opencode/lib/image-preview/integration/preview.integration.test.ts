import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { ANNOTATION_MARKER, displayAnnotation } from "../../../image-display-annotation/helpers"
import {
  cleanup,
  type Instance,
  type MockStep,
  promptAsync,
  startInstance,
  startTui,
  waitFor,
} from "./harness"

const FIXTURES = "/tmp/image-preview-fixtures"

const script: MockStep[] = [
  { kind: "tool", name: "image_display", args: { path: `${FIXTURES}/landscape.png` } },
  { kind: "tool", name: "image_display", args: { path: "sub/relative.png" } },
  { kind: "tool", name: "image_display", args: { path: "/tmp/image-preview-does-not-exist.png" } },
  { kind: "tool", name: "image_display", args: { path: `${FIXTURES}/big-screenshot.png` } },
  {
    kind: "tool",
    name: "image_display",
    args: { path: [`${FIXTURES}/landscape.png`, `${FIXTURES}/big-screenshot.png`] },
  },
  { kind: "tool", name: "image_dismiss", args: {} },
  { kind: "text", text: "Done." },
]

// The viewer wrapper writes one file per spawn containing that spawn's
// arguments, one per line. Detached viewers run concurrently, so a shared
// append-only log interleaves lines; per-spawn files keep grouped viewers
// (multiple paths in one spawn) distinguishable from repeated single spawns.
async function viewerSpawnGroups(dir: string): Promise<string[][]> {
  const entries = await fs.readdir(dir).catch(() => [])
  const groups: string[][] = []
  for (const entry of entries.sort()) {
    const content = await readFile(path.join(dir, entry), "utf8")
    const lines = content.split("\n").filter(Boolean)
    if (lines.length) groups.push(lines)
  }
  return groups
}

type Bundle = { info: Record<string, any>; parts: Array<Record<string, any>> }

async function messages(instance: Instance, sessionID: string): Promise<Bundle[]> {
  return (await (await fetch(`${instance.baseUrl}/session/${sessionID}/message`)).json()) as Bundle[]
}

async function toolParts(instance: Instance, sessionID: string): Promise<Array<Record<string, any>>> {
  const list = await messages(instance, sessionID)
  return list.flatMap((bundle) => (bundle.parts ?? []).filter((part) => part.type === "tool"))
}

function textParts(list: Bundle[]): Array<Record<string, any>> {
  return list.flatMap((bundle) => (bundle.parts ?? []).filter((part) => part.type === "text"))
}

async function createSession(instance: Instance, title: string): Promise<string> {
  return (
    await (
      await fetch(`${instance.baseUrl}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      })
    ).json()
  ).id as string
}

describe("image preview end-to-end (viewer spawner)", () => {
  let instance: Instance | undefined
  let sessionID: string
  let viewerDir: string
  let dismissLog: string

  beforeAll(async () => {
    instance = await startInstance(script)
    await copyFile(`${FIXTURES}/spaces source (1).png`, path.join(instance.workdir, "sub", "relative.png"))
    viewerDir = path.join(instance.home, "viewer.spawns")
    dismissLog = path.join(instance.home, "dismiss.log")
    const viewerScript = path.join(instance.home, "record-viewer.sh")
    const dismissScript = path.join(instance.home, "record-dismiss.sh")
    await writeFile(
      viewerScript,
      "#!/bin/sh\ndir=\"$VIEWER_DIR\"\nmkdir -p \"$dir\"\nfile=$(mktemp \"$dir/spawn.XXXXXX\")\nfor arg in \"$@\"; do echo \"$arg\" >> \"$file\"; done\n",
    )
    await writeFile(dismissScript, "#!/bin/sh\necho DISMISS >> \"$DISMISS_LOG\"\n")
    await chmod(viewerScript, 0o755)
    await chmod(dismissScript, 0o755)
    await startTui(instance, {
      OPENCODE_IMAGE_PREVIEW_VIEWER: viewerScript,
      OPENCODE_IMAGE_PREVIEW_DISMISS: dismissScript,
      VIEWER_DIR: viewerDir,
      DISMISS_LOG: dismissLog,
    })
    sessionID = await createSession(instance, "image preview e2e")
    await promptAsync(instance, sessionID, "show me the images")
    await waitFor(
      "dismiss command run",
      async () => {
        const log = await readFile(dismissLog, "utf8").catch(() => "")
        return log.split("\n").filter(Boolean).length >= 1 ? true : undefined
      },
      200_000,
    )
  }, 240_000)

  afterAll(async () => {
    await cleanup(instance)
  })

  test("agent sees image_display and image_dismiss tools", () => {
    const tools = (instance!.llm.mainRequests[0]?.tools ?? []) as Array<{ function?: { name?: string } }>
    const names = tools.map((tool) => tool.function?.name ?? (tool as any).name)
    expect(names).toContain("image_display")
    expect(names).toContain("image_dismiss")
  })

  test("tool returns expected outputs in order (abs, relative, missing, big, grouped, dismiss)", async () => {
    const parts = await toolParts(instance!, sessionID)
    const ours = parts.filter((part) => part.tool === "image_display" || part.tool === "image_dismiss")
    // The server resolves the session directory through /var -> /private/var.
    const realWorkdir = await fs.realpath(instance!.workdir)
    expect(ours.map((part) => part.state?.output)).toEqual([
      `Displayed image: ${FIXTURES}/landscape.png`,
      `Displayed image: ${path.join(realWorkdir, "sub", "relative.png")}`,
      "Image not found: /tmp/image-preview-does-not-exist.png",
      `Displayed image: ${FIXTURES}/big-screenshot.png`,
      `Displayed image: ${FIXTURES}/landscape.png\nDisplayed image: ${FIXTURES}/big-screenshot.png`,
      "Dismissed displayed image",
    ])
  })

  test("completed displays expose resolved paths as title and metadata", async () => {
    const parts = await toolParts(instance!, sessionID)
    const displays = parts.filter((part) => part.tool === "image_display" && part.state?.status === "completed")
    const realWorkdir = await fs.realpath(instance!.workdir)
    const shown = displays.filter((part) => Array.isArray(part.state.metadata?.paths))
    expect(displays).toHaveLength(5)
    expect(shown.map((part) => part.state.title)).toEqual([
      `${FIXTURES}/landscape.png`,
      "sub/relative.png",
      `${FIXTURES}/big-screenshot.png`,
      `${FIXTURES}/landscape.png (+1 more)`,
    ])
    expect(shown.map((part) => part.state.metadata.paths)).toEqual([
      [`${FIXTURES}/landscape.png`],
      [path.join(realWorkdir, "sub", "relative.png")],
      [`${FIXTURES}/big-screenshot.png`],
      [`${FIXTURES}/landscape.png`, `${FIXTURES}/big-screenshot.png`],
    ])
    const failed = displays.find((part) => part.state.input?.path === "/tmp/image-preview-does-not-exist.png")
    expect(failed?.state.metadata?.paths).toBeUndefined()
  })

  test("viewer is spawned once per display, with all paths of a grouped display in one spawn", async () => {
    const realWorkdir = await fs.realpath(instance!.workdir)
    // Viewers are spawned detached, so their shell wrappers write their spawn
    // files in OS scheduling order; the set of spawns is the contract, not the
    // order, and a spawn file may still be mid-write when its sibling exists.
    const groups = await waitFor("viewer spawns", async () => {
      const found = await viewerSpawnGroups(viewerDir)
      const paths = found.reduce((count, group) => count + group.length, 0)
      return found.length >= 4 && paths >= 5 ? found : undefined
    })
    const normalized = (group: string[]) => [...group].sort()
    expect(groups.map(normalized).sort()).toEqual(
      [
        [`${FIXTURES}/landscape.png`],
        [path.join(realWorkdir, "sub", "relative.png")],
        [`${FIXTURES}/big-screenshot.png`],
        [`${FIXTURES}/landscape.png`, `${FIXTURES}/big-screenshot.png`],
      ]
        .map(normalized)
        .sort(),
    )
  })

  test("dismiss command is run once", async () => {
    const dismissed = (await readFile(dismissLog, "utf8")).split("\n").filter(Boolean)
    expect(dismissed).toEqual(["DISMISS"])
  })

  test("no TUI crash", async () => {
    const log = await readFile(instance!.tuiLog, "utf8")
    expect(log).not.toContain("opencode crashed")
    expect(log).not.toContain("PluginError")
  })

  test("assistant text annotates displayed images and requests stay marker-free", async () => {
    const parts = await waitFor("annotated final text", async () => {
      const found = textParts(await messages(instance!, sessionID)).find(
        (part) => typeof part.text === "string" && part.text.startsWith("Done."),
      )
      return found ?? undefined
    })
    // The server resolves the session directory through /var -> /private/var.
    const realWorkdir = await fs.realpath(instance!.workdir)
    expect(parts.text).toBe(
      `Done.${displayAnnotation(`${FIXTURES}/landscape.png`)}${displayAnnotation(
        path.join(realWorkdir, "sub", "relative.png"),
      )}${displayAnnotation(`${FIXTURES}/big-screenshot.png`)}${displayAnnotation(
        `${FIXTURES}/landscape.png`,
      )}${displayAnnotation(`${FIXTURES}/big-screenshot.png`)}`,
    )

    // A follow-up turn replays the annotated text to the provider; the strip
    // half must remove it from the outgoing request. The first turn's text is
    // annotated, so an unannotated "Done." can only be the second turn.
    await promptAsync(instance!, sessionID, "confirm")
    await waitFor("second turn text", async () => {
      const texts = textParts(await messages(instance!, sessionID)).filter((part) => part.text === "Done.")
      return texts.length >= 1 ? true : undefined
    })

    const requests = JSON.stringify(instance!.llm.mainRequests)
    expect(requests).not.toContain(ANNOTATION_MARKER)
    expect(requests).toContain("Done.")
  })
})
