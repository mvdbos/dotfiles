import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  ExploreAdmissionCancelledError,
  ExploreAdmissionQueue,
  ExploreAdmissionTimeoutError,
  EXPLORE_ADMISSION_TIMEOUT_MS,
  type ExploreQueueOptions,
} from "./concurrency-queue"

const queues: ExploreAdmissionQueue[] = []
const directories: string[] = []

afterEach(() => {
  for (const queue of queues.splice(0)) queue.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function makeQueue(options: Omit<ExploreQueueOptions, "path"> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "opencode-explore-queue-"))
  directories.push(directory)
  return makeQueueIn(directory, options)
}

function makeQueueIn(directory: string, options: Omit<ExploreQueueOptions, "path"> = {}) {
  const queue = new ExploreAdmissionQueue({
    path: join(directory, "queue.sqlite"),
    timeoutMs: 100,
    pollMs: 2,
    process: { pid: queues.length + 1, start: `test-${queues.length + 1}` },
    isProcessAlive: () => true,
    ...options,
  })
  queues.push(queue)
  return queue
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 500
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not become true")
    await Bun.sleep(1)
  }
}

describe("ExploreAdmissionQueue", () => {
  test("keeps the production timeout at 60 seconds", () => {
    expect(EXPLORE_ADMISSION_TIMEOUT_MS).toBe(60_000)
  })

  test("admits one request and keeps the owner until release", async () => {
    const queue = makeQueue()
    const lease = await queue.acquire()

    expect(queue.inspect().owner?.token).toBe(lease.token)
    expect(queue.inspect().waiters).toHaveLength(0)
    expect(lease.release()).toBe(true)
    expect(queue.inspect().owner).toBeNull()
  })

  test("makes a second request wait and admits it after release", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-explore-shared-"))
    directories.push(directory)
    const firstQueue = makeQueueIn(directory)
    const secondQueue = makeQueueIn(directory)
    const first = await firstQueue.acquire()
    let secondStarted = false
    const secondPromise = secondQueue.acquire().then((lease) => {
      secondStarted = true
      return lease
    })

    await waitUntil(() => secondQueue.inspect().waiters.length === 1)
    expect(secondStarted).toBe(false)
    first.release()

    const second = await secondPromise
    expect(secondStarted).toBe(true)
    second.release()
  })

  test("admits waiters in FIFO registration order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-explore-fifo-"))
    directories.push(directory)
    const ownerQueue = makeQueueIn(directory)
    const firstWaiterQueue = makeQueueIn(directory)
    const secondWaiterQueue = makeQueueIn(directory)
    const owner = await ownerQueue.acquire()
    const order: string[] = []
    const firstPromise = firstWaiterQueue.acquire().then((lease) => {
      order.push("first")
      return lease
    })
    const secondPromise = secondWaiterQueue.acquire().then((lease) => {
      order.push("second")
      return lease
    })

    await waitUntil(() => ownerQueue.inspect().waiters.length === 2)
    owner.release()
    const first = await firstPromise
    expect(order).toEqual(["first"])
    first.release()
    const second = await secondPromise
    expect(order).toEqual(["first", "second"])
    second.release()
  })

  test("times out a waiter and removes its FIFO row", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-explore-timeout-"))
    directories.push(directory)
    const ownerQueue = makeQueueIn(directory)
    const waiterQueue = makeQueueIn(directory, { timeoutMs: 35, pollMs: 2 })
    const owner = await ownerQueue.acquire()
    const started = Date.now()

    await expect(waiterQueue.acquire()).rejects.toBeInstanceOf(ExploreAdmissionTimeoutError)
    expect(Date.now() - started).toBeGreaterThanOrEqual(30)
    expect(waiterQueue.inspect().waiters).toHaveLength(0)
    owner.release()
  })

  test("cancels promptly and removes a waiter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-explore-cancel-"))
    directories.push(directory)
    const ownerQueue = makeQueueIn(directory)
    const waiterQueue = makeQueueIn(directory, { timeoutMs: 500, pollMs: 100 })
    const owner = await ownerQueue.acquire()
    const controller = new AbortController()
    const waiting = waiterQueue.acquire(controller.signal)

    await waitUntil(() => waiterQueue.inspect().waiters.length === 1)
    controller.abort()
    await expect(waiting).rejects.toBeInstanceOf(ExploreAdmissionCancelledError)
    expect(waiterQueue.inspect().waiters).toHaveLength(0)
    owner.release()
  })

  test("only the current owner can release, and release is idempotent", async () => {
    const queue = makeQueue()
    const lease = await queue.acquire()

    expect(queue.release("wrong-token")).toBe(false)
    expect(queue.inspect().owner?.token).toBe(lease.token)
    expect(lease.release()).toBe(true)
    expect(lease.release()).toBe(false)
  })

  test("does not steal a live slow owner", async () => {
    const pathDirectory = mkdtempSync(join(tmpdir(), "opencode-explore-live-"))
    directories.push(pathDirectory)
    const path = join(pathDirectory, "queue.sqlite")
    const ownerQueue = new ExploreAdmissionQueue({
      path,
      process: { pid: 101, start: "owner-start" },
      isProcessAlive: () => true,
    })
    const waiterQueue = new ExploreAdmissionQueue({
      path,
      timeoutMs: 30,
      pollMs: 2,
      process: { pid: 102, start: "waiter-start" },
      isProcessAlive: () => true,
    })
    queues.push(ownerQueue, waiterQueue)
    const owner = await ownerQueue.acquire()

    await expect(waiterQueue.acquire()).rejects.toBeInstanceOf(ExploreAdmissionTimeoutError)
    expect(waiterQueue.inspect().owner?.token).toBe(owner.token)
    owner.release()
  })

  test("recovers an owner whose process is gone", async () => {
    const pathDirectory = mkdtempSync(join(tmpdir(), "opencode-explore-crash-"))
    directories.push(pathDirectory)
    const path = join(pathDirectory, "queue.sqlite")
    const crashedQueue = new ExploreAdmissionQueue({
      path,
      process: { pid: 201, start: "crashed-start" },
      isProcessAlive: () => true,
    })
    const recoveringQueue = new ExploreAdmissionQueue({
      path,
      timeoutMs: 30,
      pollMs: 2,
      process: { pid: 202, start: "recovery-start" },
      isProcessAlive: (identity) => identity.pid !== 201,
    })
    queues.push(crashedQueue, recoveringQueue)
    await crashedQueue.acquire()
    crashedQueue.close()

    const recovered = await recoveringQueue.acquire()
    expect(recoveringQueue.inspect().owner?.token).toBe(recovered.token)
    recovered.release()
  })

  test("serializes two attempts to recover the same stale owner", async () => {
    const pathDirectory = mkdtempSync(join(tmpdir(), "opencode-explore-recovery-"))
    directories.push(pathDirectory)
    const path = join(pathDirectory, "queue.sqlite")
    const crashedQueue = new ExploreAdmissionQueue({
      path,
      process: { pid: 301, start: "crashed-start" },
      isProcessAlive: () => true,
    })
    const recoveryA = new ExploreAdmissionQueue({
      path,
      timeoutMs: 35,
      pollMs: 2,
      process: { pid: 302, start: "recovery-a" },
      isProcessAlive: (identity) => identity.pid !== 301,
    })
    const recoveryB = new ExploreAdmissionQueue({
      path,
      timeoutMs: 35,
      pollMs: 2,
      process: { pid: 303, start: "recovery-b" },
      isProcessAlive: (identity) => identity.pid !== 301,
    })
    queues.push(crashedQueue, recoveryA, recoveryB)
    await crashedQueue.acquire()
    crashedQueue.close()

    const results = await Promise.all([
      recoveryA.acquire().then((lease) => ({ lease })).catch((error) => ({ error })),
      recoveryB.acquire().then((lease) => ({ lease })).catch((error) => ({ error })),
    ])
    const leases = results.filter((result): result is { lease: Awaited<ReturnType<ExploreAdmissionQueue["acquire"]>> } => "lease" in result)
    const errors = results.filter((result) => "error" in result)
    expect(leases).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toBeInstanceOf(ExploreAdmissionTimeoutError)
    leases[0].lease.release()
  })
})
