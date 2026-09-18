/// <reference path="../explore-controls/bun-shims.d.ts" />

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Database as SQLiteDatabase } from "bun:sqlite"

export const SUBAGENT_QUEUE_POLL_MS = 100
const SQLITE_BUSY_TIMEOUT_MS = 5_000

export class SubagentAdmissionTimeoutError extends Error {
  constructor(resource: string, timeoutMs: number, message?: string) {
    super(message ?? `${resource} subagent admission timed out after ${timeoutMs}ms.`)
    this.name = "SubagentAdmissionTimeoutError"
  }
}

export class SubagentAdmissionCancelledError extends Error {
  constructor(resource: string) {
    super(`${resource} subagent admission was cancelled before a worker became available.`)
    this.name = "SubagentAdmissionCancelledError"
  }
}

export type ProcessIdentity = {
  pid: number
  start: string
}

export type SubagentQueueOptions = {
  resource: string
  timeoutMs: number
  timeoutMessage?: string
  path?: string
  pollMs?: number
  now?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  process?: ProcessIdentity
  isProcessAlive?: (identity: ProcessIdentity) => boolean
}

export type SubagentLease = {
  token: string
  release: () => boolean
}

type QueueRow = {
  token: string
  pid: number
  process_start: string
}

type OwnerRow = QueueRow

export function subagentQueuePath() {
  return process.env.OPENCODE_SUBAGENT_QUEUE_PATH ?? join(homedir(), ".cache", "opencode", "subagent-concurrency.sqlite")
}

export function currentProcessIdentity(pid = process.pid): ProcessIdentity {
  return { pid, start: processStartIdentity(pid) ?? "" }
}

export function processStartIdentity(pid: number) {
  try {
    const result = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="])
    if (!result.success) return ""
    return result.stdout.toString().trim()
  } catch {
    return ""
  }
}

function defaultProcessAlive(identity: ProcessIdentity) {
  try {
    process.kill(identity.pid, 0)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true
    return false
  }

  if (!identity.start) return true
  const current = processStartIdentity(identity.pid)
  return !current || current === identity.start
}

function defaultSleep(resource: string) {
  return (milliseconds: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new SubagentAdmissionCancelledError(resource))
        return
      }

      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort)
        resolve()
      }, milliseconds)

      function abort() {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        reject(new SubagentAdmissionCancelledError(resource))
      }

      signal.addEventListener("abort", abort, { once: true })
    })
}

export class SubagentAdmissionQueue {
  readonly resource: string
  readonly timeoutMs: number
  readonly pollMs: number
  readonly process: ProcessIdentity

  private readonly db: SQLiteDatabase
  private readonly now: () => number
  private readonly timeoutMessage?: string
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  private readonly isProcessAlive: (identity: ProcessIdentity) => boolean

  constructor(options: SubagentQueueOptions) {
    const path = options.path ?? subagentQueuePath()
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
    this.db = new SQLiteDatabase(path)
    this.db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
    if (path !== ":memory:") this.db.run("PRAGMA journal_mode = WAL")
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subagent_waiters (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        resource TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        pid INTEGER NOT NULL,
        process_start TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subagent_owners (
        resource TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        pid INTEGER NOT NULL,
        process_start TEXT NOT NULL,
        acquired_at INTEGER NOT NULL
      )
    `)

    this.resource = options.resource
    this.timeoutMs = options.timeoutMs
    this.timeoutMessage = options.timeoutMessage
    this.pollMs = options.pollMs ?? SUBAGENT_QUEUE_POLL_MS
    this.process = options.process ?? currentProcessIdentity()
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep(this.resource)
    this.isProcessAlive = options.isProcessAlive ?? defaultProcessAlive
  }

  async acquire(signal: AbortSignal = new AbortController().signal): Promise<SubagentLease> {
    if (signal.aborted) throw new SubagentAdmissionCancelledError(this.resource)

    const token = randomUUID()
    this.enqueue(token)
    const deadline = this.now() + this.timeoutMs

    try {
      while (true) {
        if (signal.aborted) throw new SubagentAdmissionCancelledError(this.resource)
        if (this.now() >= deadline) {
          throw new SubagentAdmissionTimeoutError(this.resource, this.timeoutMs, this.timeoutMessage)
        }
        if (this.tryAcquire(token)) {
          if (signal.aborted) {
            this.release(token)
            throw new SubagentAdmissionCancelledError(this.resource)
          }
          return { token, release: () => this.release(token) }
        }

        const remaining = deadline - this.now()
        if (remaining <= 0) {
          throw new SubagentAdmissionTimeoutError(this.resource, this.timeoutMs, this.timeoutMessage)
        }
        await this.sleep(Math.min(this.pollMs, remaining), signal)
      }
    } catch (error) {
      this.removeWaiter(token)
      throw error
    }
  }

  release(token: string) {
    return this.transaction(() => {
      const owner = this.owner()
      if (!owner || owner.token !== token) return false
      const result = this.db.run(
        "DELETE FROM subagent_owners WHERE resource = ? AND token = ?",
        this.resource,
        token,
      )
      this.db.run("DELETE FROM subagent_waiters WHERE resource = ? AND token = ?", this.resource, token)
      return result.changes > 0
    })
  }

  removeWaiter(token: string) {
    return this.transaction(
      () => this.db.run("DELETE FROM subagent_waiters WHERE resource = ? AND token = ?", this.resource, token).changes > 0,
    )
  }

  inspect() {
    return this.transaction(() => {
      this.pruneDeadWaiters()
      return {
        owner: this.owner(),
        waiters: this.db
          .query("SELECT token, pid, process_start FROM subagent_waiters WHERE resource = ? ORDER BY position")
          .all(this.resource) as QueueRow[],
      }
    })
  }

  close() {
    this.db.close()
  }

  private enqueue(token: string) {
    this.transaction(() => {
      this.pruneDeadWaiters()
      this.db.run(
        "INSERT INTO subagent_waiters (resource, token, pid, process_start, created_at) VALUES (?, ?, ?, ?, ?)",
        this.resource,
        token,
        this.process.pid,
        this.process.start,
        this.now(),
      )
    })
  }

  private tryAcquire(token: string) {
    return this.transaction(() => {
      this.pruneDeadWaiters()
      const owner = this.owner()
      if (owner && this.isProcessAlive({ pid: owner.pid, start: owner.process_start })) return false
      if (owner) {
        this.db.run("DELETE FROM subagent_owners WHERE resource = ? AND token = ?", this.resource, owner.token)
      }

      const first = this.db
        .query("SELECT token FROM subagent_waiters WHERE resource = ? ORDER BY position LIMIT 1")
        .get(this.resource) as { token: string } | null
      if (!first || first.token !== token) return false

      this.db.run("DELETE FROM subagent_waiters WHERE resource = ? AND token = ?", this.resource, token)
      this.db.run(
        "INSERT INTO subagent_owners (resource, token, pid, process_start, acquired_at) VALUES (?, ?, ?, ?, ?)",
        this.resource,
        token,
        this.process.pid,
        this.process.start,
        this.now(),
      )
      return true
    })
  }

  private owner() {
    return this.db
      .query("SELECT token, pid, process_start FROM subagent_owners WHERE resource = ?")
      .get(this.resource) as OwnerRow | null
  }

  private pruneDeadWaiters() {
    const waiters = this.db
      .query("SELECT token, pid, process_start FROM subagent_waiters WHERE resource = ? ORDER BY position")
      .all(this.resource) as QueueRow[]
    for (const waiter of waiters) {
      if (!this.isProcessAlive({ pid: waiter.pid, start: waiter.process_start })) {
        this.db.run("DELETE FROM subagent_waiters WHERE resource = ? AND token = ?", this.resource, waiter.token)
      }
    }
  }

  private transaction<T>(work: () => T) {
    return this.db.transaction(work).immediate()
  }
}
