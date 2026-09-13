/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/Users/matthijs/.opencode/bin/opencode"
export const EXPECTED_VERSION = "1.18.30"
export const PLUGIN_PATH = path.resolve(import.meta.dir, "../../plugins/mlx-serve-loop-retry.ts")

type BunServer = { port?: number; stop(closeActiveConnections?: boolean): Promise<void> }

export type BunSubprocess = {
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

export type FixtureRequest = {
  index: number
  body: Record<string, any>
  headers: Record<string, string>
}

export type FixtureReply =
  | { kind: "text"; text: string }
  | { kind: "loop"; text: string }
  | { kind: "length"; text: string }
  | { kind: "tool"; tool: string; args: unknown; text?: string }
  | { kind: "status"; status: number; body: unknown }

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

export function isTitleRequest(body: Record<string, any>): boolean {
  return textOf(body).includes("Generate a title for this conversation")
}

export function isSummarizerRequest(body: Record<string, any>): boolean {
  const text = textOf(body)
  return text.includes("<conversation>") || text.includes("Create a new anchored summary")
}

export class MockMlx {
  readonly requests: FixtureRequest[] = []
  handler: (body: Record<string, any>, index: number) => FixtureReply | Promise<FixtureReply> = () => ({
    kind: "text",
    text: "done",
  })

  private readonly server: BunServer

  constructor() {
    this.server = runtime().serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => this.handle(request),
    })
  }

  get url(): string {
    return `http://127.0.0.1:${this.server.port}`
  }

  get baseURL(): string {
    return `${this.url}/v1`
  }

  turnRequests(): FixtureRequest[] {
    return this.requests.filter((request) => !isTitleRequest(request.body) && !isSummarizerRequest(request.body))
  }

  clear(): void {
    this.requests.length = 0
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
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })
    const index = this.requests.length
    this.requests.push({ index, body, headers })
    const reply = await this.handler(body, index)

    if (reply.kind === "status") {
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { "content-type": "application/json" },
      })
    }
    if (reply.kind === "tool") {
      return this.sse([
        this.chunk(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${index}`,
                type: "function",
                function: { name: reply.tool, arguments: JSON.stringify(reply.args) },
              },
            ],
          },
          null,
        ),
        this.chunk({}, "tool_calls"),
      ])
    }
    if (reply.kind === "loop") {
      return this.sse([
        this.chunk({ role: "assistant", content: reply.text }, null),
        this.chunk({}, "length", { finish_details: { type: "repetition_loop" } }),
      ])
    }
    if (reply.kind === "length") {
      return this.sse([this.chunk({ role: "assistant", content: reply.text }, null), this.chunk({}, "length")])
    }
    return this.sse([this.chunk({ role: "assistant", content: reply.text }, null), this.chunk({}, "stop")])
  }

  private chunk(delta: Record<string, unknown>, finish: string | null, extra: Record<string, unknown> = {}) {
    return {
      id: "chatcmpl-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [{ index: 0, delta, finish_reason: finish, ...extra }],
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

export type Instance = {
  readonly home: string
  readonly workdir: string
  readonly configDir: string
  readonly baseUrl: string
  readonly providerID: string
  readonly modelID: string
  readonly logs: string[]
  proc: BunSubprocess
  stop(): Promise<void>
}

export type ProviderFixture = {
  id: string
  modelID: string
  baseURL: string
  name?: string
  apiKey?: string
  model?: Record<string, unknown>
}

type StartOptions = {
  mockBaseURL?: string
  provider?: ProviderFixture
  retries?: number
  agentExtra?: Record<string, unknown>
  configExtra?: Record<string, unknown>
}

const MOCK_MODEL = {
  name: "Mock Model",
  tool_call: true,
  limit: { context: 128_000, output: 8_192 },
}

function resolveProvider(options: StartOptions): ProviderFixture {
  if (options.provider) return options.provider
  return {
    id: "mock",
    modelID: "mock-model",
    baseURL: options.mockBaseURL ?? "",
    name: "Mock",
    apiKey: "test-key",
    model: MOCK_MODEL,
  }
}

function instanceConfig(options: StartOptions, provider: ProviderFixture): Record<string, unknown> {
  const modelRef = `${provider.id}/${provider.modelID}`
  const agentExtra = options.agentExtra ?? {}
  const override = (key: string) => {
    const value = agentExtra[key]
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  }
  return {
    $schema: "https://opencode.ai/config.json",
    model: modelRef,
    small_model: modelRef,
    provider: {
      [provider.id]: {
        npm: "@ai-sdk/openai-compatible",
        name: provider.name ?? provider.id,
        options: { baseURL: provider.baseURL, apiKey: provider.apiKey ?? "test-key" },
        models: {
          [provider.modelID]: provider.model ?? MOCK_MODEL,
        },
      },
    },
    agent: {
      build: { model: modelRef, permission: { bash: "allow", edit: "allow" }, ...override("build") },
      title: { model: modelRef, ...override("title") },
      summary: { model: modelRef, ...override("summary") },
    },
    plugin: [
      [
        pathToFileURL(PLUGIN_PATH).href,
        {
          provider: provider.id,
          ...(options.retries === undefined ? {} : { retries: options.retries }),
        },
      ],
    ],
    ...options.configExtra,
  }
}

async function freePort(): Promise<number> {
  const server = runtime().serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("could not allocate a TCP port")
  return port
}

async function pump(stream: ReadableStream<Uint8Array> | number | undefined, logs: string[]): Promise<void> {
  if (!stream || typeof stream === "number") return
  const decoder = new TextDecoder()
  try {
    for await (const chunk of stream) logs.push(decoder.decode(chunk, { stream: true }))
  } catch {
    // process ended
  }
}

async function waitForServer(baseUrl: string, proc: BunSubprocess, logs: string[], timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = ""
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`opencode exited early (${proc.exitCode}): ${lastError}\n${logs.join("").slice(-2000)}`)
    }
    try {
      const response = await fetch(`${baseUrl}/session`)
      if (response.ok) return
      lastError = `status ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await runtime().sleep(150)
  }
  throw new Error(`opencode server did not become ready: ${lastError}\n${logs.join("").slice(-2000)}`)
}

export async function startInstance(options: StartOptions): Promise<Instance> {
  const home = await mkdtemp(path.join(tmpdir(), "mlx-serve-loop-retry-"))
  const workdir = path.join(home, "workdir")
  const configDir = path.join(home, "xdg-config", "opencode")
  const provider = resolveProvider(options)
  await mkdir(configDir, { recursive: true })
  await mkdir(workdir, { recursive: true })
  await writeFile(path.join(configDir, "opencode.json"), JSON.stringify(instanceConfig(options, provider), null, 2))

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = runtime().spawn([OPENCODE_BIN, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workdir,
    env: {
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
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  const logs: string[] = []
  void pump(proc.stdout, logs)
  void pump(proc.stderr, logs)

  const instance: Instance = {
    home,
    workdir,
    configDir,
    baseUrl,
    providerID: provider.id,
    modelID: provider.modelID,
    logs,
    proc,
    async stop() {
      if (proc.exitCode === null) {
        proc.kill()
        await proc.exited
      }
    },
  }

  try {
    await waitForServer(baseUrl, proc, logs)
  } catch (error) {
    await instance.stop()
    throw error
  }
  return instance
}

export async function cleanup(instance: Instance | undefined): Promise<void> {
  if (!instance) return
  await instance.stop()
  await rm(instance.home, { recursive: true, force: true })
}

export async function cleanupAll(instances: Instance[]): Promise<void> {
  for (const instance of instances) await instance.stop()
  for (const home of new Set(instances.map((instance) => instance.home))) {
    await rm(home, { recursive: true, force: true })
  }
}

async function api<T>(instance: Instance, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${instance.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${route} failed: ${response.status} ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function createSession(instance: Instance, title = "integration"): Promise<string> {
  const session = await api<{ id: string }>(instance, "POST", "/session", { title })
  return session.id
}

export async function promptAsync(instance: Instance, sessionID: string, text: string): Promise<void> {
  await api(instance, "POST", `/session/${sessionID}/prompt_async`, {
    agent: "build",
    model: { providerID: instance.providerID, modelID: instance.modelID },
    parts: [{ type: "text", text }],
  })
}

export async function messages(instance: Instance, sessionID: string): Promise<MessageBundle[]> {
  return api<MessageBundle[]>(instance, "GET", `/session/${sessionID}/message`)
}

export async function sessionStatus(instance: Instance): Promise<Record<string, { type: string }>> {
  return api(instance, "GET", "/session/status")
}

export function assistantMessages(list: MessageBundle[]): MessageBundle[] {
  return list.filter((bundle) => bundle.info?.role === "assistant")
}

export function userMessages(list: MessageBundle[]): MessageBundle[] {
  return list.filter((bundle) => bundle.info?.role === "user")
}

export function messageText(bundle: MessageBundle): string {
  return (bundle.parts ?? [])
    .filter((part) => part.type === "text" && part.synthetic !== true)
    .map((part) => String(part.text ?? ""))
    .join("\n")
}

export function pluginLogs(instance: Instance): string[] {
  return instance.logs.filter((line) => line.includes("[mlx-serve-loop-retry]"))
}

export function pluginEvents(instance: Instance): string[] {
  return pluginLogs(instance).map((line) => {
    const match = line.match(/"event":"([^"]+)"/)
    return match ? match[1]! : ""
  })
}

export function hasPluginEvent(instance: Instance, event: string): boolean {
  return pluginEvents(instance).includes(event)
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

export { path, rm }
