/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import {
  applyForeignContinuation,
  applyWatchdogMessage,
  beginRealTurn,
  cadenceEligibleCount,
  claimCadence,
  claimIdle,
  createSessionState,
  deferClaim,
  isProtected,
  recordTool,
  settleClaim,
  settleInFlight,
  type InFlight,
} from "./state"

function tool(seq: number, callID = `call-${seq}`, status: "completed" | "error" = "completed") {
  return { seq, callID, name: "bash", status, input: `input-${seq}`, result: `result-${seq}` }
}

function cadenceOptions() {
  return { everyTools: 3, snapshotKey: "snap-1", maxRecentTools: 12 }
}

describe("tool accounting", () => {
  test("counts each terminal call once", () => {
    const state = createSessionState()
    expect(recordTool(state, tool(1))).toBe(true)
    expect(recordTool(state, tool(1))).toBe(false)
    expect(state.unclaimedSignificantTools).toBe(1)
    expect(state.recentTools.size).toBe(1)
  })

  test("claims at the threshold and freezes absolute evidence", () => {
    const state = createSessionState()
    for (let seq = 1; seq <= 3; seq += 1) recordTool(state, tool(seq))
    expect(cadenceEligibleCount(state, 3)).toBe(3)
    const claim = claimCadence(state, cadenceOptions())!
    expect(claim).toBeDefined()
    expect(claim.claimedToolCount).toBe(3)
    expect(claim.throughToolSeq).toBe(3)
    expect(claim.evidence.tools.map((entry) => entry.seq)).toEqual([3, 2, 1])
    expect(state.unclaimedSignificantTools).toBe(0)
    expect(claimCadence(state, cadenceOptions())).toBeUndefined()
  })

  test("success advances baselines; failure restores ownership", () => {
    const state = createSessionState()
    for (let seq = 1; seq <= 3; seq += 1) recordTool(state, tool(seq))
    const success = claimCadence(state, cadenceOptions())!
    settleClaim(state, success, true)
    expect(state.lastCheckToolSeq).toBe(3)
    expect(state.unclaimedSignificantTools).toBe(0)

    for (let seq = 4; seq <= 6; seq += 1) recordTool(state, tool(seq))
    const failed = claimCadence(state, cadenceOptions())!
    settleClaim(state, failed, false)
    expect(state.lastCheckToolSeq).toBe(3)
    expect(state.unclaimedSignificantTools).toBe(3)
    expect(cadenceEligibleCount(state, 3)).toBe(3)
  })
})

describe("deferred cadence ownership", () => {
  test("cancelled idle ownership unions disjoint sequences and admits cadence immediately", () => {
    const state = createSessionState()
    for (let seq = 1; seq <= 2; seq += 1) recordTool(state, tool(seq))
    const idle = claimIdle(state, { idleKey: "idle-1", snapshotKey: "snap", maxRecentTools: 12 })
    deferClaim(state, idle)
    recordTool(state, tool(3))
    expect(cadenceEligibleCount(state, 3)).toBe(3)

    const claim = claimCadence(state, cadenceOptions())!
    expect(claim.claimedToolCount).toBe(3)
    expect(state.deferredCadenceClaim).toBeUndefined()
    expect(state.unclaimedSignificantTools).toBe(0)
  })

  test("repeated transfers never duplicate a sequence and consume the deferred owner once", () => {
    const state = createSessionState()
    recordTool(state, tool(1))
    const first = claimIdle(state, { idleKey: "idle-1", snapshotKey: "snap", maxRecentTools: 12 })
    deferClaim(state, first)
    const duplicate = claimIdle(state, { idleKey: "idle-2", snapshotKey: "snap", maxRecentTools: 12 })
    deferClaim(state, duplicate)
    expect(state.deferredCadenceClaim!.ownedSequences).toEqual([1])
    expect(state.deferredCadenceClaim!.claimedToolCount).toBe(1)

    recordTool(state, tool(2))
    recordTool(state, tool(3))
    const claim = claimCadence(state, cadenceOptions())!
    expect(claim.claimedToolCount).toBe(3)
    expect(state.deferredCadenceClaim).toBeUndefined()
    expect(claimCadence(state, cadenceOptions())).toBeUndefined()
  })
})

describe("settlement compare-and-set", () => {
  test("only one settlement wins per check", () => {
    const state = createSessionState()
    const inFlight: InFlight = {
      checkID: "check-1",
      epoch: state.turnEpoch,
      trigger: claimIdle(state, { idleKey: "idle", snapshotKey: "snap", maxRecentTools: 12 }),
      settlement: "active",
      abort: new AbortController(),
      slowToastShown: false,
    }
    state.inFlight = inFlight
    expect(settleInFlight(state, { checkID: "check-1", outcome: "completed" })).toBe("won")
    expect(settleInFlight(state, { checkID: "check-1", outcome: "cancelling" })).toBe("lost")
    expect(settleInFlight(state, { checkID: "check-1", outcome: "completed" })).toBe("lost")
  })
})

describe("turn state", () => {
  test("real turns reset budgets and epochs while foreign continuations preserve them", () => {
    const state = createSessionState()
    beginRealTurn(state, "first task", "u1")
    const epoch = state.turnEpoch
    state.deliveryBudget.baseDeliveryUsed = true
    applyForeignContinuation(state, "goal-0.1.49-active")
    expect(state.turnEpoch).toBe(epoch)
    expect(state.deliveryBudget.baseDeliveryUsed).toBe(true)
    expect(state.currentTask).toBe("first task")
    applyWatchdogMessage(state)
    expect(state.turnEpoch).toBe(epoch)
    beginRealTurn(state, "second task", "u2")
    expect(state.turnEpoch).toBe(epoch + 1)
    expect(state.deliveryBudget.baseDeliveryUsed).toBe(false)
    expect(state.originalTask).toBe("first task")
    expect(state.currentTask).toBe("second task")
  })

  test("protected work prevents eviction eligibility", () => {
    const state = createSessionState()
    state.unclaimedSignificantTools = 3
    expect(isProtected(state)).toBe(false)
    state.pendingTrigger = claimCadence(state, cadenceOptions())
    expect(isProtected(state)).toBe(true)
  })
})
