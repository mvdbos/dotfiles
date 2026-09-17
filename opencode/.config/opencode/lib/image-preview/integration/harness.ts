/// <reference path="../../../explore-controls/bun-shims.d.ts" />

import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/Users/matthijs/.opencode/bin/opencode"
export const REAL_CONFIG = path.resolve(import.meta.dir, "../../../")

type BunServer = { port?: number; stop(closeActiveConnections?: boolean): Promise<void> }
type BunSubprocess = {
  pid: number
  exitCode: number | null
  kill(signal?: string): void
  exited: Promise<number>
}
type BunRuntime = {
  serve(options: { port: number; hostname: string; fetch: (request: Request) => Response | Promise<Response> }): BunServer
  spawn(command: string[], options?: Record<string, unknown>): BunSubprocess
  sleep(ms: number): Promise<void>
}

function runtime(): BunRuntime {
  return (globalThis as unknown as { Bun: BunRuntime }).Bun
}

export type MockStep = { kind: "tool"; name: string; args: Record<string, unknown> } | { kind: "text"; text: string }

export class ScriptedLlm {
  mainRequests: Record<string, any>[] = []
  private step = 0

  private readonly server: BunServer
  constructor(private readonly script: MockStep[]) {
    this.server = runtime().serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => this.handle(request) })
  }

  get baseURL(): string {
    return `http://127.0.0.1:${this.server.port}/v1`
  }

  async stop(): Promise<void> {
    await this.server.stop(true)
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const body = (await request.json()) as Record<string, any>
    if (body.messages?.some((m: any) => typeof m.content === "string" && m.content.includes("title"))) {
      return Response.json({ choices: [{ message: { content: "Image preview E2E" } }] })
    }
    this.mainRequests.push(body)
    const step = this.script[Math.min(this.step++, this.script.length - 1)]
    if (step.kind === "text") {
      return this.sse([
        { choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: step.text }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ])
    }
    return this.sse([
      {
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                { index: 0, id: `call_${this.step}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ])
  }

  private sse(chunks: Array<Record<string, unknown>>): Response {
    const payload =
      chunks.map((chunk) => `data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: "mock-model", ...chunk })}\n\n`).join("") +
      "data: [DONE]\n\n"
    return new Response(payload, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
  }
}

export type Instance = {
  home: string
  workdir: string
  baseUrl: string
  tuiLog: string
  llm: ScriptedLlm
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

export async function startInstance(script: MockStep[]): Promise<Instance> {
  const llm = new ScriptedLlm(script)
  const home = await mkdtemp(path.join(tmpdir(), "image-preview-e2e-"))
  const workdir = path.join(home, "workdir")
  const configDir = path.join(home, "xdg-config", "opencode")
  await mkdir(path.join(workdir, "sub"), { recursive: true })
  await mkdir(path.join(configDir, "tools"), { recursive: true })
  await mkdir(path.join(configDir, "lib/image-preview"), { recursive: true })
  await mkdir(path.join(configDir, "tui-plugins"), { recursive: true })
  await mkdir(path.join(configDir, "plugins"), { recursive: true })
  await mkdir(path.join(configDir, "image-display-annotation"), { recursive: true })
  await symlink(path.join(REAL_CONFIG, "node_modules"), path.join(configDir, "node_modules"))

  await copyFile(path.join(REAL_CONFIG, "tools/image.ts"), path.join(configDir, "tools/image.ts"))
  for (const file of ["image.ts"]) {
    await copyFile(path.join(REAL_CONFIG, `lib/image-preview/${file}`), path.join(configDir, `lib/image-preview/${file}`))
  }
  await copyFile(path.join(REAL_CONFIG, "tui-plugins/image-preview.ts"), path.join(configDir, "tui-plugins/image-preview.ts"))
  await copyFile(
    path.join(REAL_CONFIG, "plugins/image-display-annotation.ts"),
    path.join(configDir, "plugins/image-display-annotation.ts"),
  )
  await copyFile(
    path.join(REAL_CONFIG, "image-display-annotation/helpers.ts"),
    path.join(configDir, "image-display-annotation/helpers.ts"),
  )
  await writeFile(path.join(configDir, "package.json"), JSON.stringify({ dependencies: { "@opencode-ai/plugin": "1.4.3" } }))

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
  await writeFile(
    path.join(configDir, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: modelRef,
      provider: {
        mock: {
          npm: "@ai-sdk/openai-compatible",
          name: "Mock",
          options: { baseURL: llm.baseURL, apiKey: "test-key" },
          models: { "mock-model": model },
        },
      },
      agent: {
        build: { model: modelRef, permission: { bash: "allow", edit: "allow" } },
        title: { model: modelRef },
        summary: { model: modelRef },
      },
    }),
  )
  await writeFile(
    path.join(configDir, "tui.json"),
    JSON.stringify({ $schema: "https://opencode.ai/tui.json", plugin: ["./tui-plugins/image-preview.ts"] }),
  )

  const portServer = runtime().serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
  const port = portServer.port
  await portServer.stop(true)
  const baseUrl = `http://127.0.0.1:${port}`
  const proc = runtime().spawn([OPENCODE_BIN, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workdir,
    env: envFor(home),
    stdout: "ignore",
    stderr: "ignore",
  })

  const instance: Instance = {
    home,
    workdir,
    baseUrl,
    tuiLog: path.join(home, "tui.log"),
    llm,
    proc,
    async stop() {
      if (instance.tui && instance.tui.exitCode === null) {
        try {
          process.kill(-instance.tui.pid, "SIGTERM")
        } catch {
          instance.tui.kill()
        }
        await Promise.race([instance.tui.exited, runtime().sleep(2000)])
        if (instance.tui.exitCode === null) {
          try {
            process.kill(-instance.tui.pid, "SIGKILL")
          } catch {
            instance.tui.kill("SIGKILL")
          }
        }
      }
      if (proc.exitCode === null) {
        proc.kill()
        await proc.exited
      }
      await llm.stop()
    },
  }

  const deadline = Date.now() + 30_000
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`opencode server exited early (${proc.exitCode})`)
    try {
      if ((await fetch(`${baseUrl}/session`)).ok) break
    } catch {}
    if (Date.now() > deadline) {
      await instance.stop()
      throw new Error("opencode server did not become ready")
    }
    await runtime().sleep(150)
  }
  return instance
}

export async function startTui(instance: Instance, extraEnv: Record<string, string> = {}): Promise<void> {
  const proc = runtime().spawn(["script", "-q", instance.tuiLog, OPENCODE_BIN, "attach", instance.baseUrl], {
    cwd: instance.workdir,
    env: { ...envFor(instance.home), ...extraEnv },
    detached: true,
    stdout: "ignore",
    stderr: "ignore",
  })
  instance.tui = proc
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const log = await readFile(instance.tuiLog, "utf8").catch(() => "")
      throw new Error(`tui exited early (${proc.exitCode}): ${log.slice(-2000)}`)
    }
    const log = await readFile(instance.tuiLog, "utf8").catch(() => "")
    if (log.includes("Ask anything")) return
    await runtime().sleep(200)
  }
  throw new Error("tui did not reach its home screen")
}

export async function api<T>(instance: Instance, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${instance.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${route} failed: ${response.status} ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function promptAsync(instance: Instance, sessionID: string, text: string): Promise<void> {
  await api(instance, "POST", `/session/${sessionID}/prompt_async`, {
    agent: "build",
    model: { providerID: "mock", modelID: "mock-model" },
    parts: [{ type: "text", text }],
  })
}

export async function cleanup(instance: Instance | undefined): Promise<void> {
  if (!instance) return
  await instance.stop()
  await rm(instance.home, { recursive: true, force: true })
}

export async function waitFor<T>(label: string, check: () => T | undefined | Promise<T | undefined>, timeoutMs = 40_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result !== undefined) return result
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await runtime().sleep(100)
  }
}
