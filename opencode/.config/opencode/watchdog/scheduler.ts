import {
  SubagentAdmissionCancelledError,
  SubagentAdmissionQueue,
  SubagentAdmissionTimeoutError,
  type SubagentLease,
} from "../subagent-controls/concurrency-queue"

export const WATCHDOG_QUEUE_RESOURCE = "watchdog-critic"
export const ACTIVITY_TOAST_MS = 750

export class WatchdogLease {
  private readonly queue: SubagentAdmissionQueue
  private closed = false

  constructor(options: { path?: string } = {}) {
    this.queue = new SubagentAdmissionQueue({
      resource: WATCHDOG_QUEUE_RESOURCE,
      timeoutMs: 1,
      pollMs: 1,
      ...(options.path ? { path: options.path } : {}),
    })
  }

  async tryAcquire(): Promise<SubagentLease | undefined> {
    if (this.closed) return undefined
    try {
      return await this.queue.acquire(new AbortController().signal)
    } catch (error) {
      if (error instanceof SubagentAdmissionTimeoutError || error instanceof SubagentAdmissionCancelledError) {
        return undefined
      }
      throw error
    }
  }

  release(lease: SubagentLease): boolean {
    return lease.release()
  }

  close(): void {
    this.closed = true
    this.queue.close()
  }
}

export class ExploreGate {
  private readonly active = new Set<string>()

  markAdmitted(sessionID: string): void {
    this.active.add(sessionID)
  }

  markEnded(sessionID: string): void {
    this.active.delete(sessionID)
  }

  get activeCount(): number {
    return this.active.size
  }

  isActive(): boolean {
    return this.active.size > 0
  }

  clear(): void {
    this.active.clear()
  }
}

export function rotateRoots(roots: string[], cursor: number): { root: string; nextCursor: number } | undefined {
  if (roots.length === 0) return undefined
  const index = ((cursor % roots.length) + roots.length) % roots.length
  return { root: roots[index]!, nextCursor: index + 1 }
}

export function selectAdmissibleTrigger<T extends { kind: string }>(input: {
  idle?: T
  revalidation?: T
  cadence?: T
}): { trigger: T; kind: "idle" | "revalidation" | "cadence" } | undefined {
  if (input.idle) return { trigger: input.idle, kind: "idle" }
  if (input.revalidation) return { trigger: input.revalidation, kind: "revalidation" }
  if (input.cadence) return { trigger: input.cadence, kind: "cadence" }
  return undefined
}
