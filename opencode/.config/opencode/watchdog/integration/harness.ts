/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/Users/matthijs/.opencode/bin/opencode"

type BunServer = { port?: number; stop(closeActiveConnections?: boolean): Promise<void> }

export type BunSubprocess = {
  pid: number
  exitCode: number | null
  kill(signal?: string): void
  exited: Promise<number>
  stdout?: ReadableStream<Uint8Array>
  stderr?: ReadableStream<Uint8Array>
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

export type CapturedRequest = {
  kind: "main" | "critic" | "title"
  body: Record<string, any>
}

export type MainScriptStep =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; args: Record<string, unknown>; id?: string }

function messageText(body: Record<string, any>): string {
  const parts: string[] = []
  for (const message of body.messages ?? []) {
    if (typeof message.content === "string") parts.push(message.content)
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item && typeof item === "object" && item.type === "text" && typeof item.text === "string") {
          parts.push(item.text)
        }
      }
    }
  }
  return parts.join("\n")
}

export class ProbeLlm {
  readonly requests: CapturedRequest[] = []
  criticText = '{"status":"ok"}'
  holdCritic = false
  criticAborts = 0
  activeCritic = 0
  maxActiveCritic = 0
  mainScript: MainScriptStep[] = []
  mainRequests = 0
  mainHoldIndex?: number
  mainHold?: Promise<void>
  usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
  private toolCallCounter = 0

  private readonly server: BunServer

  constructor() {
    this.server = runtime().serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => this.handle(request),
    })
  }

  get baseURL(): string {
    return `http://127.0.0.1:${this.server.port}/v1`
  }

  requestsOf(kind: CapturedRequest["kind"]): CapturedRequest[] {
    return this.requests.filter((request) => request.kind === kind)
  }

  async stop(): Promise<void> {
    await this.server.stop(true)
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 })
    }
    const body = (await request.json()) as Record<string, any>
    const model = typeof body.model === "string" ? body.model : ""

    if (model.includes("critic")) {
      this.requests.push({ kind: "critic", body })
      return this.criticResponse(request)
    }

    const text = messageText(body)
    if (text.includes("Generate a title for this conversation")) {
      this.requests.push({ kind: "title", body })
      return this.sse([this.chunk({ role: "assistant" }, null), this.chunk({ content: "Probe Title" }, "stop")])
    }

    this.requests.push({ kind: "main", body })
    const withUsage = this.usageChunk(body)
    const index = this.mainRequests
    const step = this.mainScript[index] ?? { kind: "text", text: "Done." }
    this.mainRequests += 1
    if (this.mainHoldIndex === index && this.mainHold) await this.mainHold
    if (step.kind === "tool") {
      this.toolCallCounter += 1
      const id = step.id ?? `call_${this.toolCallCounter}`
      return this.sse([
        this.chunk({ role: "assistant" }, null),
        this.chunk(
          {
            tool_calls: [
              {
                index: 0,
                id,
                type: "function",
                function: { name: step.tool, arguments: JSON.stringify(step.args) },
              },
            ],
          },
          null,
        ),
        this.chunk({}, "tool_calls"),
        ...withUsage,
      ])
    }
    return this.sse([
      this.chunk({ role: "assistant" }, null),
      this.chunk({ content: step.text }, "stop"),
      ...withUsage,
    ])
  }

  private usageChunk(body: Record<string, any>): unknown[] {
    if (body.stream_options?.include_usage !== true) return []
    return [
      {
        id: "chatcmpl-probe",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "probe-model",
        choices: [],
        usage: this.usage,
      },
    ]
  }

  private async criticResponse(request: Request): Promise<Response> {
    this.activeCritic += 1
    this.maxActiveCritic = Math.max(this.maxActiveCritic, this.activeCritic)
    if (this.holdCritic) {
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) return resolve()
        request.signal.addEventListener("abort", () => resolve(), { once: true })
      })
      this.criticAborts += 1
      this.activeCritic -= 1
      return new Response("aborted", { status: 499 })
    }
    this.activeCritic -= 1
    return this.sse([this.chunk({ role: "assistant" }, null), this.chunk({ content: this.criticText }, "stop")])
  }

  private chunk(delta: Record<string, unknown>, finish: string | null): unknown {
    return {
      id: "chatcmpl-probe",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "probe-model",
      choices: [{ index: 0, delta, finish_reason: finish }],
    }
  }

  private sse(chunks: unknown[]): Response {
    const payload = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
    return new Response(payload, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  }
}

export type ProbeInstance = {
  home: string
  workdir: string
  configDir: string
  baseUrl: string
  llm: ProbeLlm
  proc: BunSubprocess
  tuiLog: string
  tui?: BunSubprocess
  logs(): string
  stop(): Promise<void>
}

function envFor(home: string, extra: Record<string, string>): Record<string, string> {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "xdg-config"),
    XDG_DATA_HOME: path.join(home, "xdg-data"),
    XDG_CACHE_HOME: path.join(home, "xdg-cache"),
    XDG_STATE_HOME: path.join(home, "xdg-state"),
    OPENCODE_TEST_HOME: home,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DB: path.join(home, "opencode.db"),
    TERM: "xterm-256color",
    ...extra,
  } as Record<string, string>
}

async function freePort(): Promise<number> {
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

const repoRoot = path.resolve(import.meta.dir, "../..")

export type ProbeOptions = {
  pluginEntry?: string
  pluginExport?: string
  env?: Record<string, string>
  plugins?: string[]
  linkCachePackages?: string[]
  watchdogConfig?: Record<string, unknown>
  writeConfig?: (input: { configDir: string; baseURL: string }) => void
}

export async function startProbeInstance(options: ProbeOptions = {}): Promise<ProbeInstance> {
  const llm = new ProbeLlm()
  const home = mkdtempSync(path.join(tmpdir(), "watchdog-probe-"))
  const workdir = path.join(home, "workdir")
  const configDir = path.join(home, "xdg-config", "opencode")
  const cachePackagesDir = path.join(home, "xdg-cache", "opencode", "packages")
  mkdirSync(workdir, { recursive: true })
  mkdirSync(path.join(configDir, "plugins"), { recursive: true })

  for (const scope of options.linkCachePackages ?? []) {
    const source = path.join(homedir(), ".cache", "opencode", "packages", scope)
    const target = path.join(cachePackagesDir, scope)
    if (!existsSync(source) || existsSync(target)) continue
    mkdirSync(path.dirname(target), { recursive: true })
    symlinkSync(source, target, "dir")
  }

  cpSync(path.join(repoRoot, "watchdog"), path.join(configDir, "watchdog"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  })
  cpSync(path.join(repoRoot, "plugin-generated-user"), path.join(configDir, "plugin-generated-user"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  })
  cpSync(path.join(repoRoot, "subagent-controls"), path.join(configDir, "subagent-controls"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  })
  cpSync(path.join(repoRoot, "explore-controls"), path.join(configDir, "explore-controls"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  })

  const pluginEntry = options.pluginEntry ?? path.join(repoRoot, "watchdog/integration/probe-plugin.ts")
  if (pluginEntry.startsWith(path.join(repoRoot, "plugins") + path.sep)) {
    cpSync(pluginEntry, path.join(configDir, "plugins", path.basename(pluginEntry)))
  } else {
    const target = path.join(configDir, "watchdog", "integration", path.basename(pluginEntry))
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(pluginEntry, target)
    writeFileSync(
      path.join(configDir, "plugins", path.basename(pluginEntry)),
      `export { ${options.pluginExport ?? "WatchdogProbePlugin"} } from "../watchdog/integration/${path.basename(pluginEntry, ".ts")}"\n`,
    )
  }

  const model = {
    name: "Probe Model",
    attachment: false,
    reasoning: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: 128_000, output: 8_192 },
    cost: { input: 0, output: 0 },
    options: {},
  }
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: "probe/main-model",
    ...(options.plugins ? { plugin: options.plugins } : {}),
    provider: {
      probe: {
        npm: "@ai-sdk/openai-compatible",
        name: "Probe",
        options: { baseURL: llm.baseURL, apiKey: "test-key" },
        models: { "main-model": model, "critic-model": { ...model, name: "Critic Model" } },
      },
    },
    agent: {
      build: { model: "probe/main-model", permission: { bash: "allow", edit: "allow" } },
      title: { model: "probe/main-model" },
      summary: { model: "probe/main-model" },
    },
  }
  if (options.writeConfig) {
    options.writeConfig({ configDir, baseURL: llm.baseURL })
  } else {
    writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify(config, null, 2))
  }
  if (options.watchdogConfig) {
    writeFileSync(path.join(configDir, "watchdog.json"), JSON.stringify(options.watchdogConfig, null, 2))
  }

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = runtime().spawn(
    [OPENCODE_BIN, "serve", "--print-logs", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: workdir,
      env: envFor(home, options.env ?? {}),
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const logChunks: string[] = []
  const drain = (stream: ReadableStream<Uint8Array> | undefined) => {
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    void (async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        logChunks.push(decoder.decode(value, { stream: true }))
        if (logChunks.length > 1000) logChunks.splice(0, logChunks.length - 1000)
      }
    })().catch(() => {})
  }
  drain(proc.stdout)
  drain(proc.stderr)

  const instance: ProbeInstance = {
    home,
    workdir,
    configDir,
    baseUrl,
    llm,
    proc,
    tuiLog: path.join(home, "tui.log"),
    logs: () => logChunks.join(""),
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
      await llm.stop()
    },
  }

  try {
    await waitForServer(baseUrl, proc)
  } catch (error) {
    await instance.stop()
    throw error
  }
  return instance
}

export async function api<T>(host: { baseUrl: string }, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${host.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${route} failed: ${response.status} ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function createSession(host: { baseUrl: string }, title = "probe"): Promise<string> {
  const session = await api<{ id: string }>(host, "POST", "/session", { title })
  return session.id
}

export async function promptAsync(
  host: { baseUrl: string },
  sessionID: string,
  text: string,
  model = { providerID: "probe", modelID: "main-model" },
): Promise<void> {
  await api(host, "POST", `/session/${sessionID}/prompt_async`, {
    agent: "build",
    model,
    parts: [{ type: "text", text }],
  })
}

export async function listSessions(host: { baseUrl: string }): Promise<Array<Record<string, any>>> {
  return api<Array<Record<string, any>>>(host, "GET", "/session")
}

export async function getSession(host: { baseUrl: string }, sessionID: string): Promise<Record<string, any>> {
  return api<Record<string, any>>(host, "GET", `/session/${sessionID}`)
}

export async function waitFor<T>(
  label: string,
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    const result = await check()
    if (result !== undefined) return result
    last = result
    await runtime().sleep(intervalMs)
  }
  throw new Error(`timed out waiting for ${label} (last=${JSON.stringify(last)})`)
}

export function probeEntryUrl(configDir: string, name = "probe-plugin.ts"): string {
  return pathToFileURL(path.join(configDir, "plugins", name)).href
}

export async function startTui(
  host: ProbeInstance,
  options: { sessionID?: string; readyText?: string; timeoutMs?: number } = {},
): Promise<void> {
  const args = ["script", "-q", host.tuiLog, OPENCODE_BIN, "attach", host.baseUrl]
  if (options.sessionID) args.push("--session", options.sessionID)
  const proc = runtime().spawn(args, {
    cwd: host.workdir,
    env: envFor(host.home, {}),
    detached: true,
    stdout: "ignore",
    stderr: "ignore",
  })
  host.tui = proc

  const readLog = () => {
    try {
      return readFileSync(host.tuiLog, "utf8")
    } catch {
      return ""
    }
  }

  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  const readyText = options.readyText ?? "Ask anything"
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`tui exited early (${proc.exitCode}): ${readLog().slice(-2000)}`)
    }
    if (readLog().includes(readyText)) return
    await runtime().sleep(200)
  }
  throw new Error(`tui did not reach its home screen: ${readLog().slice(-2000)}`)
}

export async function readTuiLog(host: ProbeInstance): Promise<string> {
  try {
    return readFileSync(host.tuiLog, "utf8")
  } catch {
    return ""
  }
}
