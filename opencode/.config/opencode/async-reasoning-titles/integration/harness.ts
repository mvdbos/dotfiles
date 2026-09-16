/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/Users/matthijs/.opencode/bin/opencode"

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
  file(input: string): { text(): Promise<string>; exists(): Promise<boolean> }
}

function runtime(): BunRuntime {
  return (globalThis as unknown as { Bun: BunRuntime }).Bun
}

export function textOf(body: Record<string, any>): string {
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

export type LlmRequest = { kind: "main" | "activity" | "conversation-title"; body: Record<string, any> }

export class MockLlm {
  readonly requests: LlmRequest[] = []
  reasoning = "Looking at the parser and checking pixel-grid alignment against the snapshot."
  mainText = "Done."
  activityTitle = "Checking pixel-grid alignment"
  activityStatus = 200
  activityHold: PromiseLike<unknown> | undefined

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

  requestsOf(kind: LlmRequest["kind"]): LlmRequest[] {
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
    const text = textOf(body)
    if (text.includes("You write short activity titles")) {
      this.requests.push({ kind: "activity", body })
      if (this.activityHold) await this.activityHold
      if (this.activityStatus !== 200) {
        return new Response("failed", { status: this.activityStatus })
      }
      return Response.json({ choices: [{ message: { content: this.activityTitle } }] })
    }
    if (text.includes("Generate a title for this conversation")) {
      this.requests.push({ kind: "conversation-title", body })
      return this.sse([this.chunk({ role: "assistant", content: "E2E Title" }, "stop")])
    }
    this.requests.push({ kind: "main", body })
    return this.sse([
      this.chunk({ role: "assistant" }, null),
      this.chunk({ reasoning_content: this.reasoning }, null),
      this.chunk({ content: this.mainText }, null),
      this.chunk({}, "stop"),
    ])
  }

  private chunk(delta: Record<string, unknown>, finish: string | null): unknown {
    return {
      id: "chatcmpl-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
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

export type MessageBundle = { info: Record<string, any>; parts: Array<Record<string, any>> }

export type SessionHost = {
  baseUrl: string
  providerID: string
  modelID: string
}

export type Instance = SessionHost & {
  readonly home: string
  readonly workdir: string
  readonly configDir: string
  readonly llm: MockLlm
  readonly tuiLog: string
  tui?: BunSubprocess
  proc: BunSubprocess
  stop(): Promise<void>
}

function envFor(home: string): Record<string, string> {
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
  } as Record<string, string>
}

async function freePort(): Promise<number> {
  const server = runtime().serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("could not allocate a TCP port")
  return port
}

export { freePort }

export async function waitForServer(baseUrl: string, proc: BunSubprocess, timeoutMs = 20_000): Promise<void> {
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

export async function startInstance(): Promise<Instance> {
  const llm = new MockLlm()
  const home = await mkdtemp(path.join(tmpdir(), "async-reasoning-titles-"))
  const workdir = path.join(home, "workdir")
  const configDir = path.join(home, "xdg-config", "opencode")
  await mkdir(workdir, { recursive: true })
  await mkdir(path.join(configDir, "tui-plugins"), { recursive: true })
  await mkdir(path.join(configDir, "async-reasoning-titles"), { recursive: true })

  const pluginSource = path.resolve(import.meta.dir, "../../tui-plugins/async-reasoning-titles.ts")
  const helperSource = path.resolve(import.meta.dir, "../../async-reasoning-titles/helpers.ts")
  await copyFile(pluginSource, path.join(configDir, "tui-plugins", "async-reasoning-titles.ts"))
  await copyFile(helperSource, path.join(configDir, "async-reasoning-titles", "helpers.ts"))

  const model = {
    name: "Mock Model",
    attachment: false,
    reasoning: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: 128_000, output: 8_192 },
    cost: { input: 0, output: 0 },
    options: {},
  }
  const modelRef = "mock/mock-model"
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: modelRef,
    provider: {
      mock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock",
        options: { baseURL: llm.baseURL, apiKey: "test-key" },
        models: { "mock-model": model, "small-model": { ...model, name: "Small Model" } },
      },
    },
    agent: {
      build: { model: modelRef, permission: { bash: "allow", edit: "allow" } },
      title: { model: modelRef },
      summary: { model: modelRef },
    },
  }
  await writeFile(path.join(configDir, "opencode.json"), JSON.stringify(config, null, 2))

  const tuiConfig = {
    $schema: "https://opencode.ai/tui.json",
    plugin: [
      [
        pathToFileURL(path.join(configDir, "tui-plugins", "async-reasoning-titles.ts")).href,
        { model: "mock/small-model" },
      ],
    ],
  }
  await writeFile(path.join(configDir, "tui.json"), JSON.stringify(tuiConfig, null, 2))

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = runtime().spawn(
    [OPENCODE_BIN, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: workdir,
      env: envFor(home),
      stdout: "ignore",
      stderr: "ignore",
    },
  )

  const instance: Instance = {
    home,
    workdir,
    configDir,
    baseUrl,
    providerID: "mock",
    modelID: "mock-model",
    llm,
    tuiLog: path.join(home, "tui.log"),
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

export type TuiHost = {
  baseUrl: string
  home: string
  workdir: string
  tuiLog: string
  tui?: BunSubprocess
}

export async function startTui(host: TuiHost, env: Record<string, string> = envFor(host.home)): Promise<void> {
  const proc = runtime().spawn(["script", "-q", host.tuiLog, OPENCODE_BIN, "attach", host.baseUrl], {
    cwd: host.workdir,
    env,
    detached: true,
    stdout: "ignore",
    stderr: "ignore",
  })
  host.tui = proc

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const log = await readFile(host.tuiLog, "utf8").catch(() => "")
      throw new Error(`tui exited early (${proc.exitCode}): ${log.slice(-2000)}`)
    }
    const log = await readFile(host.tuiLog, "utf8").catch(() => "")
    if (log.includes("Ask anything")) return
    await runtime().sleep(200)
  }
  const log = await readFile(host.tuiLog, "utf8").catch(() => "")
  throw new Error(`tui did not reach its home screen: ${log.slice(-2000)}`)
}

export async function cleanup(instance: Instance | undefined): Promise<void> {
  if (!instance) return
  await instance.stop()
  await rm(instance.home, { recursive: true, force: true })
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

export async function createSession(host: SessionHost, title = "integration"): Promise<string> {
  const session = await api<{ id: string }>(host, "POST", "/session", { title })
  return session.id
}

export async function promptAsync(
  host: SessionHost,
  sessionID: string,
  text: string,
  model: { providerID: string; modelID: string } = { providerID: host.providerID, modelID: host.modelID },
): Promise<void> {
  await api(host, "POST", `/session/${sessionID}/prompt_async`, {
    agent: "build",
    model,
    parts: [{ type: "text", text }],
  })
}

export async function messages(host: SessionHost, sessionID: string): Promise<MessageBundle[]> {
  return api<MessageBundle[]>(host, "GET", `/session/${sessionID}/message`)
}

export async function sessionStatus(host: SessionHost): Promise<Record<string, { type: string }>> {
  return api<Record<string, { type: string }>>(host, "GET", "/session/status")
}

export function reasoningParts(list: MessageBundle[]): Array<Record<string, any>> {
  return list.flatMap((bundle) => (bundle.parts ?? []).filter((part) => part.type === "reasoning"))
}

export function assistantCompleted(list: MessageBundle[]): boolean {
  const assistants = list.filter((bundle) => bundle.info?.role === "assistant")
  const last = assistants.at(-1)
  return Boolean(last?.info?.time?.completed)
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
