/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ExploreGate, WatchdogLease } from "./scheduler"

describe("watchdog lease", () => {
  test("permits at most one critic across independent lease instances", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "watchdog-lease-")), "queue.sqlite")
    const first = new WatchdogLease({ path })
    const second = new WatchdogLease({ path })
    try {
      const lease = await first.tryAcquire()
      expect(lease).toBeDefined()
      expect(await second.tryAcquire()).toBeUndefined()
      expect(lease!.release()).toBe(true)
      const replacement = await second.tryAcquire()
      expect(replacement).toBeDefined()
      replacement!.release()
    } finally {
      first.close()
      second.close()
    }
  })

  test("uses an independent resource from the existing subagent types", async () => {
    const directory = mkdtempSync(join(tmpdir(), "watchdog-resource-"))
    const path = join(directory, "queue.sqlite")
    const { SubagentAdmissionQueue } = await import("../subagent-controls/concurrency-queue")
    const explore = new SubagentAdmissionQueue({ resource: "explore", timeoutMs: 1, path })
    const watchdog = new WatchdogLease({ path })
    try {
      const exploreLease = await explore.acquire()
      const watchdogLease = await watchdog.tryAcquire()
      expect(watchdogLease).toBeDefined()
      exploreLease.release()
      watchdogLease!.release()
    } finally {
      watchdog.close()
    }
  })
})

describe("explore gate", () => {
  test("tracks active exploration and clears deterministically", () => {
    const gate = new ExploreGate()
    expect(gate.isActive()).toBe(false)
    gate.markAdmitted("explore-a")
    gate.markAdmitted("explore-b")
    expect(gate.activeCount).toBe(2)
    gate.markEnded("explore-a")
    expect(gate.isActive()).toBe(true)
    gate.markEnded("explore-b")
    expect(gate.isActive()).toBe(false)
    gate.markAdmitted("explore-c")
    gate.clear()
    expect(gate.isActive()).toBe(false)
  })
})
