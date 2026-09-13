import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/Users/matthijs/.opencode/bin/opencode"
export const EXPECTED_VERSION = "1.18.30"

export type MockRequest = {
  index: number
  body: Record<string, any>
}

export type MockReply =
  | { kind: "text"; text: string }
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

export function containsReminder(body: Record<string, any>): boolean {
  return textOf(body).includes("Todo reconciliation after compaction")
}

export class MockProvider {
  readonly requests: MockRequest[] = []
  handler: (body: Record<string, any>, index: number) => MockReply | Promise<MockReply> = (body) => {
    if (isTitleRequest(body)) return { kind: "text", text: "Mock title" }
    if (isSummarizerRequest(body)) return { kind: "text", text: "## Objective\n- mock summary" }
    return { kind: "text", text: "done" }
  }

  private readonly server: Bun.Server<undefined>

  constructor() {
    this.server = Bun.serve({
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

  ordinaryRequests(): MockRequest[] {
    return this.requests.filter((request) => !isTitleRequest(request.body) && !isSummarizerRequest(request.body))
  }

  summarizerRequests(): MockRequest[] {
    return this.requests.filter((request) => isSummarizerRequest(request.body))
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
    const index = this.requests.length
    this.requests.push({ index, body })
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
    return this.sse([this.chunk({ role: "assistant", content: reply.text }, null), this.chunk({}, "stop")])
  }

  private chunk(delta: Record<string, unknown>, finish: string | null) {
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

export type Instance = {
  readonly home: string
  readonly workdir: string
  readonly configDir: string
  readonly port: number
  readonly baseUrl: string
  readonly client: OpencodeClient
  readonly logs: string[]
  proc: Bun.Subprocess
  stop(): Promise<void>
}

type StartOptions = {
  home?: string
  pluginBundle?: string
  mockBaseURL: string
  configExtra?: Record<string, unknown>
}

function instanceConfig(mockBaseURL: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    model: "mock/mock-model",
    small_model: "mock/mock-model",
    provider: {
      mock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock",
        options: { baseURL: mockBaseURL, apiKey: "test-key" },
        models: {
          "mock-model": {
            name: "Mock Model",
            tool_call: true,
            reasoning: true,
            variants: { low: { reasoningEffort: "low" } },
            limit: { context: 128_000, output: 8_192 },
          },
        },
      },
    },
    agent: {
      build: { model: "mock/mock-model" },
      compaction: { model: "mock/mock-model" },
      title: { model: "mock/mock-model" },
      summary: { model: "mock/mock-model" },
    },
    ...extra,
  }
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
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

async function waitForServer(
  baseUrl: string,
  proc: Bun.Subprocess,
  logs: string[],
  timeoutMs = 20_000,
): Promise<void> {
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
    await Bun.sleep(150)
  }
  throw new Error(`opencode server did not become ready: ${lastError}\n${logs.join("").slice(-2000)}`)
}

export async function startInstance(options: StartOptions): Promise<Instance> {
  const home = options.home ?? (await makeHome())
  const workdir = path.join(home, "workdir")
  const configDir = path.join(home, "xdg-config", "opencode")
  await mkdir(configDir, { recursive: true })
  await mkdir(workdir, { recursive: true })

  if (options.pluginBundle) {
    const pluginsDir = path.join(configDir, "plugins")
    await mkdir(pluginsDir, { recursive: true })
    await Bun.write(path.join(pluginsDir, "todo-reconcile.js"), Bun.file(options.pluginBundle))
  }

  await writeFile(
    path.join(configDir, "opencode.json"),
    JSON.stringify(instanceConfig(options.mockBaseURL, options.configExtra), null, 2),
  )

  return spawnInstance(home, workdir, configDir, options.mockBaseURL)
}

async function freshHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "todo-reconcile-"))
}

async function spawnInstance(
  home: string,
  workdir: string,
  configDir: string,
  mockBaseURL: string,
): Promise<Instance> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = Bun.spawn([OPENCODE_BIN, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
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

  const client = createOpencodeClient({ baseUrl, directory: workdir })
  const instance: Instance = {
    home,
    workdir,
    configDir,
    port,
    baseUrl,
    client,
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

export async function restartInstance(instance: Instance, mockBaseURL: string): Promise<Instance> {
  await instance.stop()
  return spawnInstance(instance.home, instance.workdir, instance.configDir, mockBaseURL)
}

export async function makeHome(): Promise<string> {
  return freshHome()
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

export async function createSession(instance: Instance, title = "integration"): Promise<string> {
  const response = await instance.client.session.create({ body: { title } })
  if (response.error || !response.data) throw new Error(`session.create failed: ${JSON.stringify(response.error)}`)
  return response.data.id
}

export async function prompt(
  instance: Instance,
  sessionID: string,
  text: string,
  options: { tools?: Record<string, boolean>; variant?: string } = {},
): Promise<void> {
  const response = await instance.client.session.prompt({
    path: { id: sessionID },
    body: {
      agent: "build",
      model: { providerID: "mock", modelID: "mock-model" },
      parts: [{ type: "text", text }],
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.variant !== undefined ? { variant: options.variant } : {}),
    },
  })
  if (response.error) throw new Error(`session.prompt failed: ${JSON.stringify(response.error)}`)
}

export async function summarize(instance: Instance, sessionID: string, auto: boolean): Promise<void> {
  const response = await instance.client.session.summarize({
    path: { id: sessionID },
    body: { providerID: "mock", modelID: "mock-model", auto } as never,
  })
  if (response.error) throw new Error(`session.summarize failed: ${JSON.stringify(response.error)}`)
}

export async function readTodos(instance: Instance, sessionID: string): Promise<unknown[]> {
  const response = await instance.client.session.todo({ path: { id: sessionID } })
  if (response.error) throw new Error(`session.todo failed: ${JSON.stringify(response.error)}`)
  return response.data ?? []
}

export function todoCall(todos: Array<{ content: string; status: string; priority: string }>): MockReply {
  return { kind: "tool", tool: "todowrite", args: { todos }, text: "todos written" }
}

export function invalidPromptError(): MockReply {
  return { kind: "status", status: 400, body: { error: { code: "invalid_prompt", message: "invalid prompt" } } }
}

export { path, rm }
