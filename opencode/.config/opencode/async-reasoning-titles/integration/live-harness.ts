/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { freePort, OPENCODE_BIN, waitForServer, type BunSubprocess, type SessionHost, type TuiHost } from "./harness"

type BunRuntime = {
  spawn(command: string[], options?: Record<string, unknown>): BunSubprocess
  sleep(ms: number): Promise<void>
}

function runtime(): BunRuntime {
  return (globalThis as unknown as { Bun: BunRuntime }).Bun
}

export type LiveInstance = SessionHost &
  TuiHost & {
    readonly root: string
    readonly env: Record<string, string>
    proc: BunSubprocess
    stop(): Promise<void>
  }

function liveEnv(root: string): Record<string, string> {
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share")
  return {
    ...process.env,
    HOME: process.env.HOME ?? homedir(),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    OPENCODE_DB: path.join(root, "opencode.db"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    TERM: "xterm-256color",
    __LIVE_AUTH_SOURCE: dataHome,
  } as Record<string, string>
}

export async function startLiveInstance(input: { providerID: string; modelID: string }): Promise<LiveInstance> {
  const root = await mkdtemp(path.join(tmpdir(), "async-reasoning-titles-live-"))
  const workdir = path.join(root, "workdir")
  const authDir = path.join(root, "data", "opencode")
  await mkdir(workdir, { recursive: true })
  await mkdir(authDir, { recursive: true })

  const env = liveEnv(root)
  const authSource = path.join(env.__LIVE_AUTH_SOURCE!, "opencode", "auth.json")
  delete env.__LIVE_AUTH_SOURCE
  await copyFile(authSource, path.join(authDir, "auth.json")).catch(() => {})

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = runtime().spawn(
    [OPENCODE_BIN, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: workdir,
      env,
      stdout: "ignore",
      stderr: "ignore",
    },
  )

  const instance: LiveInstance = {
    root,
    workdir,
    home: env.HOME!,
    env,
    baseUrl,
    providerID: input.providerID,
    modelID: input.modelID,
    tuiLog: path.join(root, "tui.log"),
    proc,
    async stop() {
      if (instance.tui && instance.tui.exitCode === null) {
        try {
          process.kill(-instance.tui.pid, "SIGTERM")
        } catch {
          instance.tui.kill()
        }
        const tui = instance.tui
        await Promise.race([tui.exited, runtime().sleep(2000)])
        if (tui.exitCode === null) {
          try {
            process.kill(-tui.pid, "SIGKILL")
          } catch {
            tui.kill("SIGKILL")
          }
        }
      }
      await runtime().spawn(["pkill", "-f", `opencode attach ${baseUrl}`], { stdout: "ignore", stderr: "ignore" }).exited
      if (proc.exitCode === null) {
        proc.kill()
        await proc.exited
      }
    },
  }

  try {
    await waitForServer(baseUrl, proc, 60_000)
  } catch (error) {
    await instance.stop()
    throw error
  }
  return instance
}

export async function cleanupLive(instance: LiveInstance | undefined): Promise<void> {
  if (!instance) return
  await instance.stop()
  await rm(instance.root, { recursive: true, force: true })
}
