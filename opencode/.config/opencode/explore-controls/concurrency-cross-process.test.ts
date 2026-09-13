/// <reference path="./bun-shims.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const workers: Array<{ kill: (signal?: string) => void; exited: Promise<number>; stdout: ReadableStream<Uint8Array> }> = []
const directories: string[] = []

afterEach(async () => {
  for (const worker of workers.splice(0)) {
    try {
      worker.kill("SIGKILL")
    } catch {
      // The worker may have exited normally.
    }
    await worker.exited
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function queuePath(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return join(directory, "queue.sqlite")
}

function spawnWorker(path: string, timeoutMs: number, holdMs: number) {
  const worker = Bun.spawn(["bun", "run", `${import.meta.dir}/concurrency-worker.ts`, path, String(timeoutMs), String(holdMs)], {
    stdout: "pipe",
    stderr: "pipe",
  })
  workers.push(worker)
  return worker
}

async function firstLine(worker: (typeof workers)[number]) {
  const reader = worker.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    output += decoder.decode(chunk.value, { stream: true })
    const newline = output.indexOf("\n")
    if (newline >= 0) return output.slice(0, newline).trim()
  }
  throw new Error(`worker exited without a status: ${output}`)
}

describe("ExploreAdmissionQueue cross-process behavior", () => {
  test("admits one worker and makes a second worker wait", async () => {
    const path = queuePath("opencode-explore-cross-process-")
    const owner = spawnWorker(path, 500, 180)
    expect(await firstLine(owner)).toBe("acquired")
    const started = Date.now()
    const waiter = spawnWorker(path, 500, 0)

    expect(await firstLine(waiter)).toBe("acquired")
    expect(Date.now() - started).toBeGreaterThanOrEqual(120)
    await Promise.all([owner.exited, waiter.exited])
  })

  test("does not steal a live slow owner", async () => {
    const path = queuePath("opencode-explore-cross-live-")
    const owner = spawnWorker(path, 500, 250)
    expect(await firstLine(owner)).toBe("acquired")
    const waiter = spawnWorker(path, 50, 0)

    expect(await firstLine(waiter)).toBe("timeout")
    await Promise.all([owner.exited, waiter.exited])
  })

  test("recovers after an owner process is killed", async () => {
    const path = queuePath("opencode-explore-cross-crash-")
    const owner = spawnWorker(path, 500, 1_000)
    expect(await firstLine(owner)).toBe("acquired")
    owner.kill("SIGKILL")
    await owner.exited

    const recovery = spawnWorker(path, 500, 0)
    expect(await firstLine(recovery)).toBe("acquired")
    await recovery.exited
  })

  test("serializes competing recovery attempts", async () => {
    const path = queuePath("opencode-explore-cross-recovery-")
    const owner = spawnWorker(path, 500, 1_000)
    expect(await firstLine(owner)).toBe("acquired")
    owner.kill("SIGKILL")
    await owner.exited

    const recoveryA = spawnWorker(path, 120, 180)
    const recoveryB = spawnWorker(path, 120, 180)
    const statuses = await Promise.all([firstLine(recoveryA), firstLine(recoveryB)])

    expect(statuses.filter((status) => status === "acquired")).toHaveLength(1)
    expect(statuses.filter((status) => status === "timeout")).toHaveLength(1)
    await Promise.all([recoveryA.exited, recoveryB.exited])
  })
})
