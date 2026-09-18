/// <reference path="../explore-controls/bun-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SubagentAdmissionQueue, SubagentAdmissionTimeoutError } from "./concurrency-queue"

const queues: SubagentAdmissionQueue[] = []
const directories: string[] = []

afterEach(() => {
  for (const queue of queues.splice(0)) queue.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function sharedPath() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-subagent-queue-"))
  directories.push(directory)
  return join(directory, "queue.sqlite")
}

function queue(path: string, resource: string) {
  const result = new SubagentAdmissionQueue({
    path,
    resource,
    timeoutMs: 30,
    pollMs: 2,
    process: { pid: queues.length + 1, start: `test-${queues.length + 1}` },
    isProcessAlive: () => true,
  })
  queues.push(result)
  return result
}

describe("SubagentAdmissionQueue", () => {
  test("serializes one resource without blocking another resource", async () => {
    const path = sharedPath()
    const exploreOwner = queue(path, "explore")
    const exploreWaiter = queue(path, "explore")
    const generalQueue = queue(path, "general")
    const exploreLease = await exploreOwner.acquire()

    const waiting = exploreWaiter.acquire()
    const generalLease = await generalQueue.acquire()

    expect(generalQueue.inspect().owner?.token).toBe(generalLease.token)
    await expect(waiting).rejects.toBeInstanceOf(SubagentAdmissionTimeoutError)
    exploreLease.release()
    generalLease.release()
  })
})
