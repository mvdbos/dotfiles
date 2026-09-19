import { parseCriticOutput, type AcceptedConcern } from "./noise"

export type CriticTextPart = {
  type?: unknown
  text?: unknown
  synthetic?: unknown
}

export type CriticPromptBody = {
  agent: string
  model: { providerID: string; modelID: string }
  tools: Record<string, boolean>
  parts: Array<{ type: "text"; text: string }>
}

export type CriticClient = {
  tool: {
    ids(): Promise<{ data?: string[]; error?: unknown }>
  }
  session: {
    create(options: { body: { parentID: string; title?: string } }): Promise<{ data?: { id?: string }; error?: unknown }>
    prompt(options: { path: { id: string }; body: CriticPromptBody }): Promise<{
      data?: { info?: unknown; parts?: CriticTextPart[] }
      error?: unknown
    }>
    abort(options: { path: { id: string } }): Promise<unknown>
    delete(options: { path: { id: string } }): Promise<unknown>
  }
}

export type CriticRunOptions = {
  rootSessionID: string
  agent: string
  model: { providerID: string; modelID: string }
  prompt: string
  minimalPrompt?: string
  timeoutMs: number
  signal?: AbortSignal
}

export type CriticRetryReason = "context_overflow" | "missing_text" | "malformed_output"

type CriticRunMetadata = {
  attempts: number
  retryReasons: CriticRetryReason[]
}

export type CriticRunResult = (
  | { kind: "ok"; raw: string; childID: string; minimalRetry: boolean }
  | { kind: "concern"; concern: AcceptedConcern; raw: string; childID: string; minimalRetry: boolean }
  | { kind: "malformed"; detail: string; raw: string; childID: string; minimalRetry: boolean }
  | {
      kind: "timeout" | "cancelled" | "error" | "context_overflow"
      detail: string
      childID?: string
      minimalRetry: boolean
    }
  ) & CriticRunMetadata

export type CriticRunnerDeps = {
  client: CriticClient
  onChildCreated?(sessionID: string): void
  onChildDisposed?(sessionID: string, deleted: boolean): void
  log?(message: string, detail?: unknown): void
  debugLog?(message: string, detail?: unknown): void
}

type PromptAttempt = {
  type: "result"
  data?: { info?: unknown; parts?: CriticTextPart[] }
  error?: unknown
} | { type: "timeout" } | { type: "cancelled" }

const CONTEXT_OVERFLOW_PATTERN =
  /context (length|window|limit|size)|maximum context|too many tokens|prompt is too long|exceeds? .*context/i

function errorMessage(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : ""
  const record = value as Record<string, unknown>
  if (typeof record.message === "string") return record.message
  if (typeof record.data === "object" && record.data !== null) {
    const data = record.data as Record<string, unknown>
    if (typeof data.message === "string") return data.message
  }
  return ""
}

export function isContextOverflow(value: unknown): boolean {
  return CONTEXT_OVERFLOW_PATTERN.test(errorMessage(value))
}

function assistantText(parts: readonly CriticTextPart[] | undefined): string | undefined {
  if (!parts) return undefined
  const texts: string[] = []
  for (const part of parts) {
    if (part?.type !== "text") continue
    if (part.synthetic === true) continue
    if (typeof part.text === "string") texts.push(part.text)
  }
  if (texts.length === 0) return undefined
  return texts.join("\n")
}

function assistantError(info: unknown): unknown {
  if (!info || typeof info !== "object") return undefined
  return (info as Record<string, unknown>).error
}

export class CriticRunner {
  private readonly deps: CriticRunnerDeps

  constructor(deps: CriticRunnerDeps) {
    this.deps = deps
  }

  async run(options: CriticRunOptions): Promise<CriticRunResult> {
    return this.attempt(options, options.prompt, false, false, 1, [])
  }

  private async attempt(
    options: CriticRunOptions,
    prompt: string,
    minimalRetry: boolean,
    malformedRetry: boolean,
    attempts: number,
    retryReasons: CriticRetryReason[],
  ): Promise<CriticRunResult> {
    const metadata = { attempts, retryReasons }
    const childID = await this.createChild(options.rootSessionID)
    if (!childID) {
      return { kind: "error", detail: "critic child session could not be created", minimalRetry, ...metadata }
    }

    let disposed = false
    let deleteSucceeded = false
    try {
      const body: CriticPromptBody = {
        agent: options.agent,
        model: options.model,
        tools: await this.disabledToolMap(),
        parts: [{ type: "text", text: prompt }],
      }

      const attempt = await this.promptWithTimeout(childID, body, options)
      if (attempt.type === "timeout" || attempt.type === "cancelled") {
        await this.abortChild(childID)
        deleteSucceeded = await this.deleteChild(childID)
        disposed = true
        return {
          kind: attempt.type,
          detail: attempt.type === "timeout" ? `critic timed out after ${options.timeoutMs}ms` : "critic run was cancelled",
          childID,
          minimalRetry,
          ...metadata,
        }
      }

      const failure = attempt.error ?? assistantError(attempt.data?.info)
      if (failure !== undefined && failure !== null) {
        if (!minimalRetry && options.minimalPrompt !== undefined && isContextOverflow(failure)) {
          await this.abortChild(childID)
          deleteSucceeded = await this.deleteChild(childID)
          disposed = true
          const routineLog = this.deps.debugLog ?? this.deps.log
          routineLog?.("watchdog critic hit context overflow; retrying with the minimal packet")
          return this.attempt(
            options,
            options.minimalPrompt,
            true,
            malformedRetry,
            attempts + 1,
            [...retryReasons, "context_overflow"],
          )
        }
        deleteSucceeded = await this.deleteChild(childID)
        disposed = true
        return {
          kind: isContextOverflow(failure) ? "context_overflow" : "error",
          detail: errorMessage(failure) || "critic request failed",
          childID,
          minimalRetry,
          ...metadata,
        }
      }

      const raw = assistantText(attempt.data?.parts)
      if (raw === undefined) {
        if (!malformedRetry) {
          deleteSucceeded = await this.deleteChild(childID)
          disposed = true
          return this.attempt(
            options,
            prompt,
            minimalRetry,
            true,
            attempts + 1,
            [...retryReasons, "missing_text"],
          )
        }
        return { kind: "malformed", detail: "critic completion carried no text part", raw: "", childID, minimalRetry, ...metadata }
      }
      const parsed = parseCriticOutput(raw)
      if (parsed.kind === "ok") return { kind: "ok", raw, childID, minimalRetry, ...metadata }
      if (parsed.kind === "concern") {
        return { kind: "concern", concern: parsed.concern, raw, childID, minimalRetry, ...metadata }
      }
      if (!malformedRetry) {
        deleteSucceeded = await this.deleteChild(childID)
        disposed = true
        return this.attempt(
          options,
          prompt,
          minimalRetry,
          true,
          attempts + 1,
          [...retryReasons, "malformed_output"],
        )
      }
      return { kind: "malformed", detail: parsed.reason, raw, childID, minimalRetry, ...metadata }
    } catch (error) {
      this.deps.log?.("watchdog critic run failed", error)
      return { kind: "error", detail: error instanceof Error ? error.message : "critic run threw", childID, minimalRetry, ...metadata }
    } finally {
      if (!disposed) {
        deleteSucceeded = await this.deleteChild(childID)
      }
      this.deps.onChildDisposed?.(childID, deleteSucceeded)
    }
  }

  private async createChild(rootSessionID: string): Promise<string | undefined> {
    try {
      const response = await this.deps.client.session.create({
        body: { parentID: rootSessionID, title: "watchdog critic" },
      })
      const id = response.data?.id
      if (!response.error && typeof id === "string" && id) {
        this.deps.onChildCreated?.(id)
        return id
      }
      this.deps.log?.("watchdog critic child creation failed", response.error)
    } catch (error) {
      this.deps.log?.("watchdog critic child creation threw", error)
    }
    return undefined
  }

  private async disabledToolMap(): Promise<Record<string, boolean>> {
    try {
      const response = await this.deps.client.tool.ids()
      const ids = Array.isArray(response.data) ? response.data : []
      return Object.fromEntries(ids.filter((id): id is string => typeof id === "string").map((id) => [id, false]))
    } catch (error) {
      this.deps.log?.("watchdog critic could not enumerate tools; denying none", error)
      return {}
    }
  }

  private async promptWithTimeout(
    childID: string,
    body: CriticPromptBody,
    options: CriticRunOptions,
  ): Promise<PromptAttempt> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortHandler: (() => void) | undefined
    const listeners: Array<Promise<PromptAttempt>> = []

    const promptPromise = this.deps.client.session
      .prompt({ path: { id: childID }, body })
      .then((response): PromptAttempt => ({ type: "result", data: response.data, error: response.error }))
      .catch((error): PromptAttempt => ({ type: "result", error }))

    listeners.push(promptPromise)
    listeners.push(
      new Promise<PromptAttempt>((resolve) => {
        timer = setTimeout(() => resolve({ type: "timeout" }), options.timeoutMs)
      }),
    )
    if (options.signal) {
      if (options.signal.aborted) return { type: "cancelled" }
      listeners.push(
        new Promise<PromptAttempt>((resolve) => {
          abortHandler = () => resolve({ type: "cancelled" })
          options.signal!.addEventListener("abort", abortHandler, { once: true })
        }),
      )
    }

    const attempt = await Promise.race(listeners)
    if (timer) clearTimeout(timer)
    if (abortHandler) options.signal?.removeEventListener("abort", abortHandler)
    return attempt
  }

  private async abortChild(childID: string): Promise<void> {
    try {
      await this.deps.client.session.abort({ path: { id: childID } })
    } catch (error) {
      this.deps.log?.("watchdog critic abort failed", error)
    }
  }

  private async deleteChild(childID: string): Promise<boolean> {
    try {
      const response = (await this.deps.client.session.delete({ path: { id: childID } })) as { error?: unknown } | undefined
      if (response?.error) {
        this.deps.log?.("watchdog critic delete returned an error", response.error)
        return false
      }
      return true
    } catch (error) {
      this.deps.log?.("watchdog critic delete failed", error)
      return false
    }
  }
}
