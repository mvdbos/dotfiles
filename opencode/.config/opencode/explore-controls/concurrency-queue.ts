/// <reference path="./bun-shims.d.ts" />

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { Database as SQLiteDatabase } from "bun:sqlite"

export const EXPLORE_ADMISSION_TIMEOUT_MS = 60_000
export const EXPLORE_QUEUE_POLL_MS = 100
const SQLITE_BUSY_TIMEOUT_MS = 5_000

export const EXPLORE_ADMISSION_TIMEOUT_MESSAGE = `Exploration was not started: the local explore worker remained busy for the 60-second admission timeout. Its completion time is unknown. Do not immediately retry or poll. If an already-running exploration covers this question, use its result when available. Otherwise continue independent work, or perform a small targeted lookup yourself with your own tools; prefer relevant files and narrow searches to limit parent-context growth.`

export class ExploreAdmissionTimeoutError extends Error {
  constructor() {
    super(EXPLORE_ADMISSION_TIMEOUT_MESSAGE)
    this.name = "ExploreAdmissionTimeoutError"
  }
}

export class ExploreAdmissionCancelledError extends Error {
  constructor() {
    super("Exploration admission was cancelled before the local explore worker became available.")
    this.name = "ExploreAdmissionCancelledError"
  }
}

export type ProcessIdentity = {
  pid: number
  start: string
}

export type ExploreQueueOptions = {
  path?: string
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  process?: ProcessIdentity
  isProcessAlive?: (identity: ProcessIdentity) => boolean
}

export type ExploreLease = {
  token: string
  release: () => boolean
}

type QueueRow = {
  token: string
  pid: number
  process_start: string
}

type OwnerRow = QueueRow

export function exploreQueuePath() {
  return process.env.OPENCODE_EXPLORE_QUEUE_PATH ?? join(homedir(), ".cache", "opencode", "explore-concurrency.sqlite")
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

function defaultSleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new ExploreAdmissionCancelledError())
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, milliseconds)

    function abort() {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(new ExploreAdmissionCancelledError())
    }

    signal.addEventListener("abort", abort, { once: true })
  })
}

export class ExploreAdmissionQueue {
  readonly timeoutMs: number
  readonly pollMs: number
  readonly process: ProcessIdentity

  private readonly db: SQLiteDatabase
  private readonly now: () => number
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  private readonly isProcessAlive: (identity: ProcessIdentity) => boolean

  constructor(options: ExploreQueueOptions = {}) {
    const path = options.path ?? exploreQueuePath()
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
    this.db = new SQLiteDatabase(path)
    this.db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
    if (path !== ":memory:") this.db.run("PRAGMA journal_mode = WAL")
    this.db.run(`
      CREATE TABLE IF NOT EXISTS explore_waiters (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        pid INTEGER NOT NULL,
        process_start TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS explore_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        token TEXT NOT NULL UNIQUE,
        pid INTEGER NOT NULL,
        process_start TEXT NOT NULL,
        acquired_at INTEGER NOT NULL
      )
    `)

    this.timeoutMs = options.timeoutMs ?? EXPLORE_ADMISSION_TIMEOUT_MS
    this.pollMs = options.pollMs ?? EXPLORE_QUEUE_POLL_MS
    this.process = options.process ?? currentProcessIdentity()
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.isProcessAlive = options.isProcessAlive ?? defaultProcessAlive
  }

  async acquire(signal: AbortSignal = new AbortController().signal): Promise<ExploreLease> {
    if (signal.aborted) throw new ExploreAdmissionCancelledError()

    const token = randomUUID()
    this.enqueue(token)
    const deadline = this.now() + this.timeoutMs

    try {
      while (true) {
        if (signal.aborted) throw new ExploreAdmissionCancelledError()
        if (this.now() >= deadline) throw new ExploreAdmissionTimeoutError()
        if (this.tryAcquire(token)) {
          if (signal.aborted) {
            this.release(token)
            throw new ExploreAdmissionCancelledError()
          }
          return { token, release: () => this.release(token) }
        }

        const remaining = deadline - this.now()
        if (remaining <= 0) throw new ExploreAdmissionTimeoutError()
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
      const result = this.db.run("DELETE FROM explore_owner WHERE singleton = 1 AND token = ?", token)
      this.db.run("DELETE FROM explore_waiters WHERE token = ?", token)
      return result.changes > 0
    })
  }

  removeWaiter(token: string) {
    return this.transaction(() => this.db.run("DELETE FROM explore_waiters WHERE token = ?", token).changes > 0)
  }

  inspect() {
    return this.transaction(() => {
      this.pruneDeadWaiters()
      return {
        owner: this.owner(),
        waiters: this.db
          .query("SELECT token, pid, process_start FROM explore_waiters ORDER BY position")
          .all() as QueueRow[],
      }
    })
  }

  close() {
    this.db.close()
  }

  private enqueue(token: string) {
    this.transaction(() => {
      this.pruneDeadWaiters()
      this.db
        .run(
          "INSERT INTO explore_waiters (token, pid, process_start, created_at) VALUES (?, ?, ?, ?)",
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
      if (owner) this.db.run("DELETE FROM explore_owner WHERE singleton = 1 AND token = ?", owner.token)

      const first = this.db
        .query("SELECT token FROM explore_waiters ORDER BY position LIMIT 1")
        .get() as { token: string } | null
      if (!first || first.token !== token) return false

      this.db.run("DELETE FROM explore_waiters WHERE token = ?", token)
      this.db.run(
        "INSERT INTO explore_owner (singleton, token, pid, process_start, acquired_at) VALUES (1, ?, ?, ?, ?)",
        token,
        this.process.pid,
        this.process.start,
        this.now(),
      )
      return true
    })
  }

  private owner() {
    return this.db.query("SELECT token, pid, process_start FROM explore_owner WHERE singleton = 1").get() as OwnerRow | null
  }

  private pruneDeadWaiters() {
    const waiters = this.db
      .query("SELECT token, pid, process_start FROM explore_waiters ORDER BY position")
      .all() as QueueRow[]
    for (const waiter of waiters) {
      if (!this.isProcessAlive({ pid: waiter.pid, start: waiter.process_start })) {
        this.db.run("DELETE FROM explore_waiters WHERE token = ?", waiter.token)
      }
    }
  }

  private transaction<T>(work: () => T) {
    return this.db.transaction(work).immediate()
  }
}
