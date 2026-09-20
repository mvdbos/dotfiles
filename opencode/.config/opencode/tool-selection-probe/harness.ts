/// <reference path="../explore-controls/bun-shims.d.ts" />

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { FIXTURE_FILES } from "./cues"

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/Users/matthijs/.opencode/bin/opencode"

export type SessionHost = {
  baseUrl: string
  providerID: string
  modelID: string
}

type BunServer = { port?: number; stop(closeActiveConnections?: boolean): Promise<void> }

export type BunSubprocess = {
  pid: number
  exitCode: number | null
  kill(signal?: string): void
  exited: Promise<number>
}

type BunRuntime = {
  serve(options: {
    port: number
    hostname: string
    fetch: (request: Request) => Response | Promise<Response>
  }): BunServer
  spawn(command: string[], options?: Record<string, unknown>): BunSubprocess
  sleep(ms: number): Promise<void>
}

function runtime(): BunRuntime {
  return (globalThis as unknown as { Bun: BunRuntime }).Bun
}

export function configRoot(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config")
  return process.env.PROBE_CONFIG_DIR ?? path.join(base, "opencode")
}

export type RealSetup = {
  configDir: string
  modelRef: string
  providerID: string
  modelID: string
  baseURL?: string
}

export async function readRealSetup(): Promise<RealSetup> {
  const configDir = configRoot()
  const raw = JSON.parse(await readFile(path.join(configDir, "opencode.json"), "utf8")) as Record<string, any>
  const modelRef = process.env.PROBE_MODEL ?? raw.model
  if (typeof modelRef !== "string" || !modelRef.includes("/")) {
    throw new Error(`no provider/model ref in ${path.join(configDir, "opencode.json")}; set PROBE_MODEL`)
  }
  const split = modelRef.indexOf("/")
  const providerID = modelRef.slice(0, split)
  const modelID = modelRef.slice(split + 1)
  const configured = raw.provider?.[providerID]?.options?.baseURL
  const baseURL = process.env.PROBE_BASE_URL ?? configured
  return {
    configDir,
    modelRef,
    providerID,
    modelID,
    baseURL: typeof baseURL === "string" ? baseURL : undefined,
  }
}

export async function probeAvailable(baseURL: string | undefined): Promise<{ ok: boolean; reason?: string }> {
  if (!baseURL) return { ok: false, reason: "the probe provider has no baseURL in opencode.json" }
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(2500) })
    if (!response.ok) return { ok: false, reason: `model server returned ${response.status}` }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: `model server unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function mirrorConfig(raw: Record<string, any>, modelRef: string): Record<string, any> {
  const mirrored = JSON.parse(JSON.stringify(raw)) as Record<string, any>
  delete mirrored.plugin
  delete mirrored.lsp
  mirrored.model = modelRef
  mirrored.agent = mirrored.agent ?? {}
  for (const name of ["title", "summary"]) {
    mirrored.agent[name] = { ...(mirrored.agent[name] ?? {}), model: modelRef }
  }
  if (mirrored.agent.explore) {
    mirrored.agent.explore = { ...mirrored.agent.explore, model: modelRef }
    delete mirrored.agent.explore.options
  }
  return mirrored
}

async function copyPromptFiles(sourceDir: string, targetDir: string, mirrored: Record<string, any>): Promise<void> {
  for (const agent of Object.values(mirrored.agent ?? {}) as Array<Record<string, any> | undefined>) {
    const prompt = agent?.prompt
    const match = typeof prompt === "string" ? prompt.match(/^\{file:(.+)\}$/) : null
    if (!match) continue
    const relative = match[1]
    if (path.isAbsolute(relative)) continue
    const target = path.join(targetDir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(path.join(sourceDir, relative), target)
  }
}

export type ProbeInstance = SessionHost & {
  readonly root: string
  readonly configDir: string
  readonly workdir: string
  proc: BunSubprocess
  stop(): Promise<void>
}

function envFor(root: string): Record<string, string> {
  return {
    ...process.env,
    HOME: path.join(root, "home"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    OPENCODE_DB: path.join(root, "opencode.db"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    DS4_API_KEY: process.env.DS4_API_KEY ?? "probe",
    TERM: "xterm-256color",
  } as Record<string, string>
}

export async function freePort(): Promise<number> {
  const server = runtime().serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("could not allocate a TCP port")
  return port
}

export async function waitForServer(baseUrl: string, proc: BunSubprocess, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = ""
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`opencode exited early (${proc.exitCode})`)
    try {
      const response = await fetch(`${baseUrl}/session`)
      if (response.ok) return
      lastError = `status ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await runtime().sleep(150)
  }
  throw new Error(`opencode server did not become ready: ${lastError}`)
}

export async function startProbeInstance(setup: RealSetup): Promise<ProbeInstance> {
  const sourceDir = setup.configDir
  const rawConfig = JSON.parse(await readFile(path.join(sourceDir, "opencode.json"), "utf8")) as Record<string, any>
  const globalRules = await readFile(path.join(sourceDir, "AGENTS.md"), "utf8")

  const root = await mkdtemp(path.join(tmpdir(), "tool-selection-probe-"))
  const configDir = path.join(root, "config", "opencode")
  const workdir = path.join(root, "workdir")
  await mkdir(configDir, { recursive: true })
  await mkdir(path.join(root, "home"), { recursive: true })
  await mkdir(workdir, { recursive: true })

  const mirrored = mirrorConfig(rawConfig, setup.modelRef)
  if (setup.baseURL) {
    const provider = mirrored.provider?.[setup.providerID] ?? {}
    mirrored.provider = mirrored.provider ?? {}
    mirrored.provider[setup.providerID] = {
      ...provider,
      options: { ...(provider.options ?? {}), baseURL: setup.baseURL },
    }
  }
  await writeFile(path.join(configDir, "opencode.json"), JSON.stringify(mirrored, null, 2))
  await writeFile(path.join(configDir, "AGENTS.md"), globalRules)
  await copyPromptFiles(sourceDir, configDir, mirrored)
  for (const [relative, content] of Object.entries(FIXTURE_FILES)) {
    const target = path.join(workdir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = runtime().spawn(
    [OPENCODE_BIN, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: workdir,
      env: envFor(root),
      stdout: "ignore",
      stderr: "ignore",
    },
  )

  const instance: ProbeInstance = {
    root,
    configDir,
    workdir,
    baseUrl,
    providerID: setup.providerID,
    modelID: setup.modelID,
    proc,
    async stop() {
      if (proc.exitCode === null) {
        proc.kill()
        await proc.exited
      }
    },
  }

  try {
    await waitForServer(baseUrl, proc)
  } catch (error) {
    await instance.stop()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return instance
}

export async function cleanupProbe(instance: ProbeInstance | undefined): Promise<void> {
  if (!instance) return
  await instance.stop()
  await rm(instance.root, { recursive: true, force: true })
}

async function api<T>(host: SessionHost, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${host.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${route} failed: ${response.status} ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function createSession(host: SessionHost, title: string): Promise<string> {
  const session = await api<{ id: string }>(host, "POST", "/session", { title })
  return session.id
}

export async function promptAsync(
  host: SessionHost,
  sessionID: string,
  text: string,
  agent = "build",
): Promise<void> {
  await api(host, "POST", `/session/${sessionID}/prompt_async`, {
    agent,
    model: { providerID: host.providerID, modelID: host.modelID },
    parts: [{ type: "text", text }],
  })
}

export function messages(host: SessionHost, sessionID: string): Promise<Array<Record<string, any>>> {
  return api(host, "GET", `/session/${sessionID}/message`)
}

export async function abortSession(host: SessionHost, sessionID: string): Promise<void> {
  await api(host, "POST", `/session/${sessionID}/abort`)
}

export function sleep(ms: number): Promise<void> {
  return runtime().sleep(ms)
}
