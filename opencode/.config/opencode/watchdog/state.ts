import type { AcceptedConcern } from "./noise"
import { DUPLICATE_HISTORY_LIMIT, newDeliveryBudget, type DeliveryBudget } from "./noise"
import type { SubagentLease } from "../subagent-controls/concurrency-queue"
import {
  boundEvidence,
  type ChangeFingerprint,
  type ClaimedEvidence,
  type FailureCandidate,
  type PreviousConcern,
  type RevalidationCandidate,
  type ToolObservation,
  type TodoObservation,
} from "./packet"

export const DEFAULT_RING_TOOLS = 24
export const DEFAULT_TERMINAL_CALL_IDS = 256
export const DEFAULT_CONCERN_HISTORY = DUPLICATE_HISTORY_LIMIT
export const DEFAULT_CHANGE_HASHES = 80
export const MAX_LIVE_ROOTS = 100

export class RingBuffer<T> {
  private readonly capacity: number
  private items: T[] = []

  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(value: T): void {
    this.items.push(value)
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity)
  }

  values(): T[] {
    return [...this.items]
  }

  clear(): void {
    this.items = []
  }

  get size(): number {
    return this.items.length
  }
}

export class LruSet<T> {
  private readonly capacity: number
  private items: T[] = []

  constructor(capacity: number, initial: Iterable<T> = []) {
    this.capacity = capacity
    for (const value of initial) this.add(value)
  }

  add(value: T): boolean {
    const index = this.items.indexOf(value)
    if (index >= 0) this.items.splice(index, 1)
    this.items.push(value)
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity)
    return index < 0
  }

  has(value: T): boolean {
    return this.items.includes(value)
  }

  values(): T[] {
    return [...this.items]
  }
}

export type ClaimedTool = ToolObservation & { callID: string }

export type ClaimedCadence = {
  kind: "cadence"
  epoch: number
  snapshotKey: string
  claimedToolCount: number
  throughToolSeq: number
  ownedSequences: number[]
  evidence: ClaimedEvidence
}

export type ClaimedIdle = {
  kind: "idle"
  epoch: number
  idleKey: string
  claimedToolCount: number
  throughToolSeq: number
  ownedSequences: number[]
  evidence: ClaimedEvidence
}

export type ClaimedRevalidation = {
  kind: "revalidation"
  epoch: number
  snapshotKey: string
  revalidationKey: string
  throughToolSeq: number
  evidence: ClaimedEvidence
  candidate: RevalidationCandidate
  hop: 1
}

export type DeferredCadenceClaim = {
  claimedToolCount: number
  fromToolSeqExclusive: number
  throughToolSeq: number
  ownedSequences: number[]
  evidence: ClaimedEvidence
}

export type InFlight = {
  checkID: string
  epoch: number
  childID?: string
  trigger: ClaimedCadence | ClaimedIdle | ClaimedRevalidation
  settlement: "active" | "cancelling" | "completed"
  abort: AbortController
  lease?: SubagentLease
  run?: Promise<unknown>
  slowToastTimer?: ReturnType<typeof setTimeout>
  slowToastShown: boolean
}

export type ActiveAdvisory = AcceptedConcern & {
  findingHash?: string
  installedPartID?: string
  installedText?: string
  concernToast?: { status: "pending" | "delivered" | "failed"; attempts: 1 | 2 }
  installedAtEpoch: number
  deliveredAtEpoch?: number
}

export type IdleAdmission = {
  generation: number
  epoch: number
  timer?: ReturnType<typeof setTimeout>
}

export type SessionState = {
  parentChecked: boolean
  turnEpoch: number
  latestUserKind: "real" | "watchdog" | "foreign"
  latestForeignPatternID?: string
  originalTask?: string
  currentTask?: string
  taskMessageID?: string
  todos: TodoObservation[]
  recentTools: RingBuffer<ClaimedTool>
  failureCandidates: FailureCandidate[]
  changeFingerprints: ChangeFingerprint[]
  deferredCadenceClaim?: DeferredCadenceClaim
  terminalCallIDs: LruSet<string>
  unclaimedSignificantTools: number
  toolSeq: number
  latestAssistantText?: string
  latestAssistantMessageID?: string
  lastCheckedOrdinarySnapshotKey?: string
  lastRevalidationKey?: string
  previousChangeHashes: Map<string, string>
  inFlight?: InFlight
  pendingTrigger?: ClaimedCadence
  pendingIdle?: ClaimedIdle
  pendingRevalidation?: ClaimedRevalidation
  idleAdmission?: IdleAdmission
  activeAdvisory?: ActiveAdvisory
  deliveredConcernHashes: LruSet<string>
  deliveryBudget: DeliveryBudget
  lastConcernToolSeq: number
  lastConcernEvidenceFingerprint?: string
  continuationClaim?: { epoch: number; findingHash: string; messageID?: string }
  lastCheckToolSeq: number
  lastIdleCheckKey?: string
  lastCheckAt?: number
  consecutiveFailures: number
  circuitOpenUntil?: number
  lastFailureAt?: number
  previousConcern?: PreviousConcern
  activity?: string
  cleanupInProgress?: boolean
  busy?: boolean
}

export function createSessionState(): SessionState {
  return {
    parentChecked: false,
    turnEpoch: 0,
    latestUserKind: "real",
    todos: [],
    recentTools: new RingBuffer<ClaimedTool>(DEFAULT_RING_TOOLS),
    failureCandidates: [],
    changeFingerprints: [],
    terminalCallIDs: new LruSet<string>(DEFAULT_TERMINAL_CALL_IDS),
    unclaimedSignificantTools: 0,
    toolSeq: 0,
    previousChangeHashes: new Map(),
    deliveredConcernHashes: new LruSet<string>(DEFAULT_CONCERN_HISTORY),
    deliveryBudget: newDeliveryBudget(),
    lastConcernToolSeq: 0,
    lastCheckToolSeq: 0,
    consecutiveFailures: 0,
  }
}

export function isProtected(state: SessionState): boolean {
  return Boolean(
    state.deferredCadenceClaim ||
      state.pendingTrigger ||
      state.pendingIdle ||
      state.pendingRevalidation ||
      state.idleAdmission ||
      state.inFlight ||
      state.activeAdvisory ||
      state.continuationClaim ||
      state.cleanupInProgress,
  )
}

export function beginRealTurn(state: SessionState, taskText: string, messageID?: string): void {
  state.turnEpoch += 1
  state.latestUserKind = "real"
  state.latestForeignPatternID = undefined
  state.currentTask = taskText
  state.taskMessageID = messageID
  if (!state.originalTask) state.originalTask = taskText
  state.deliveryBudget = newDeliveryBudget()
  state.activeAdvisory = undefined
  state.continuationClaim = undefined
}

export function applyWatchdogMessage(state: SessionState): void {
  state.latestUserKind = "watchdog"
}

export function applyForeignContinuation(state: SessionState, patternID: string): void {
  state.latestUserKind = "foreign"
  state.latestForeignPatternID = patternID
  if (state.idleAdmission?.timer) clearTimeout(state.idleAdmission.timer)
  state.idleAdmission = undefined
}

export function recordTool(
  state: SessionState,
  observation: ClaimedTool,
  change?: ChangeFingerprint,
): boolean {
  if (state.terminalCallIDs.has(observation.callID)) return false
  state.terminalCallIDs.add(observation.callID)
  state.recentTools.push(observation)
  state.unclaimedSignificantTools += 1
  if (observation.status === "error" && observation.result.trim()) {
    state.failureCandidates.push({ seq: observation.seq, tool: observation.name, evidence: `${observation.name}: ${observation.result}` })
    if (state.failureCandidates.length > 64) state.failureCandidates.splice(0, state.failureCandidates.length - 64)
  }
  if (change) {
    state.changeFingerprints.push(change)
    if (state.changeFingerprints.length > DEFAULT_CHANGE_HASHES) {
      state.changeFingerprints.splice(0, state.changeFingerprints.length - DEFAULT_CHANGE_HASHES)
    }
  }
  return true
}

function claimedEvidenceFromState(state: SessionState, throughToolSeq: number): ClaimedEvidence {
  const tools = state.recentTools
    .values()
    .filter((tool) => tool.seq <= throughToolSeq)
    .map(({ callID: _callID, ...tool }) => tool)
  return {
    task: {
      original: state.originalTask ?? "",
      current: state.currentTask ?? "",
    },
    ...(state.todos.length > 0 ? { todos: [...state.todos] } : {}),
    ...(state.latestAssistantText ? { recentAssistantText: state.latestAssistantText } : {}),
    tools,
    ...(state.failureCandidates.length > 0
      ? { failureCandidates: state.failureCandidates.filter((failure) => failure.seq <= throughToolSeq) }
      : {}),
    ...(state.changeFingerprints.length > 0
      ? { changeFingerprints: state.changeFingerprints.filter((change) => change.seq <= throughToolSeq) }
      : {}),
    ...(state.previousConcern ? { previousConcern: state.previousConcern } : {}),
  }
}

function sequencesOf(evidence: ClaimedEvidence): number[] {
  return [...new Set(evidence.tools.map((tool) => tool.seq))].sort((a, b) => a - b)
}

export function cadenceEligibleCount(state: SessionState, everyTools: number): number {
  return state.unclaimedSignificantTools + (state.deferredCadenceClaim?.claimedToolCount ?? 0)
}

export function claimCadence(
  state: SessionState,
  options: { everyTools: number; snapshotKey: string; maxRecentTools: number },
): ClaimedCadence | undefined {
  if (cadenceEligibleCount(state, options.everyTools) < options.everyTools) return undefined
  const deferred = state.deferredCadenceClaim
  const maxSeq = Math.max(
    ...state.recentTools.values().map((tool) => tool.seq),
    deferred?.throughToolSeq ?? 0,
    0,
  )
  const evidence = claimedEvidenceFromState(state, maxSeq)
  const claimedToolCount = state.unclaimedSignificantTools + (deferred?.claimedToolCount ?? 0)
  const deferredSequences = new Set(deferred?.ownedSequences ?? [])
  const ownedSequences = [
    ...new Set(
      evidence.tools
        .map((tool) => tool.seq)
        .filter((seq) => seq > state.lastCheckToolSeq || deferredSequences.has(seq)),
    ),
  ].sort((a, b) => a - b)
  state.unclaimedSignificantTools = 0
  state.deferredCadenceClaim = undefined
  return {
    kind: "cadence",
    epoch: state.turnEpoch,
    snapshotKey: options.snapshotKey,
    claimedToolCount,
    throughToolSeq: maxSeq,
    ownedSequences,
    evidence: boundEvidence(evidence, { maxRecentTools: options.maxRecentTools }),
  }
}

export function claimIdle(
  state: SessionState,
  options: { idleKey: string; snapshotKey: string; maxRecentTools: number },
): ClaimedIdle {
  const maxSeq = Math.max(...state.recentTools.values().map((tool) => tool.seq), 0)
  const evidence = claimedEvidenceFromState(state, maxSeq)
  const claimedToolCount = state.unclaimedSignificantTools
  state.unclaimedSignificantTools = 0
  return {
    kind: "idle",
    epoch: state.turnEpoch,
    idleKey: options.idleKey,
    claimedToolCount,
    throughToolSeq: maxSeq,
    ownedSequences: evidence.tools
      .map((tool) => tool.seq)
      .filter((seq) => seq > state.lastCheckToolSeq)
      .sort((a, b) => a - b),
    evidence: boundEvidence(evidence, { maxRecentTools: options.maxRecentTools }),
  }
}

export function claimRevalidation(
  state: SessionState,
  options: { candidate: RevalidationCandidate; snapshotKey: string; maxRecentTools: number },
): ClaimedRevalidation {
  const maxSeq = Math.max(...state.recentTools.values().map((tool) => tool.seq), 0)
  const evidence = claimedEvidenceFromState(state, maxSeq)
  const revalidationKey = `${options.snapshotKey}:${options.candidate.category}:${options.candidate.sourceEpoch}:${options.candidate.evidenceFingerprint}`
  return {
    kind: "revalidation",
    epoch: state.turnEpoch,
    snapshotKey: options.snapshotKey,
    revalidationKey,
    throughToolSeq: maxSeq,
    evidence: boundEvidence(evidence, { maxRecentTools: options.maxRecentTools }),
    candidate: options.candidate,
    hop: 1,
  }
}

export function deferClaim(
  state: SessionState,
  claim: ClaimedIdle | ClaimedCadence | ClaimedRevalidation,
): void {
  if (claim.kind === "revalidation") {
    state.pendingRevalidation = undefined
    return
  }
  const sequences = sequencesOf(claim.evidence)
  const existing = state.deferredCadenceClaim
  const ownedSequences = [...new Set([...(existing?.ownedSequences ?? []), ...claim.ownedSequences])].sort(
    (a, b) => a - b,
  )
  const throughToolSeq = Math.max(existing?.throughToolSeq ?? 0, claim.throughToolSeq)
  const evidence = mergeEvidence(existing?.evidence, claim.evidence, throughToolSeq)
  state.deferredCadenceClaim = {
    claimedToolCount: ownedSequences.length,
    fromToolSeqExclusive: existing?.fromToolSeqExclusive ?? Math.min(...sequences, 0),
    throughToolSeq,
    ownedSequences,
    evidence,
  }
  state.pendingIdle = undefined
  state.pendingTrigger = undefined
  state.pendingRevalidation = undefined
}

function mergeEvidence(
  existing: ClaimedEvidence | undefined,
  incoming: ClaimedEvidence,
  throughToolSeq: number,
): ClaimedEvidence {
  if (!existing) return { ...incoming }
  const tools = [...existing.tools]
  const seen = new Set(tools.map((tool) => tool.seq))
  for (const tool of incoming.tools) {
    if (seen.has(tool.seq)) continue
    tools.push(tool)
    seen.add(tool.seq)
  }
  tools.sort((left, right) => left.seq - right.seq)
  const bounded = boundEvidence(
    {
      task: existing.task.current ? existing.task : incoming.task,
      ...(incoming.todos ?? existing.todos ? { todos: incoming.todos ?? existing.todos } : {}),
      ...(existing.recentAssistantText ?? incoming.recentAssistantText
        ? { recentAssistantText: existing.recentAssistantText ?? incoming.recentAssistantText }
        : {}),
      tools: tools.filter((tool) => tool.seq <= throughToolSeq),
      ...(existing.failureCandidates || incoming.failureCandidates
        ? { failureCandidates: [...(existing.failureCandidates ?? []), ...(incoming.failureCandidates ?? [])] }
        : {}),
      ...(existing.changeFingerprints || incoming.changeFingerprints
        ? { changeFingerprints: [...(existing.changeFingerprints ?? []), ...(incoming.changeFingerprints ?? [])] }
        : {}),
      ...(existing.previousConcern ?? incoming.previousConcern
        ? { previousConcern: existing.previousConcern ?? incoming.previousConcern }
        : {}),
    },
    { maxRecentTools: DEFAULT_RING_TOOLS },
  )
  const omitted = Math.min(
    existing.omittedBeforeToolSeq ?? Number.MAX_SAFE_INTEGER,
    incoming.omittedBeforeToolSeq ?? Number.MAX_SAFE_INTEGER,
  )
  return omitted === Number.MAX_SAFE_INTEGER ? bounded : { ...bounded, omittedBeforeToolSeq: omitted }
}

export function settleClaim(
  state: SessionState,
  claim: ClaimedCadence | ClaimedIdle | ClaimedRevalidation,
  success: boolean,
): void {
  if (claim.kind === "revalidation") return
  if (success) {
    state.lastCheckToolSeq = Math.max(state.lastCheckToolSeq, claim.throughToolSeq)
    for (const change of claim.evidence.changeFingerprints ?? []) {
      state.previousChangeHashes.set(change.path, change.fingerprint)
      if (state.previousChangeHashes.size > DEFAULT_CHANGE_HASHES) {
        const first = state.previousChangeHashes.keys().next().value
        if (first !== undefined) state.previousChangeHashes.delete(first)
      }
    }
  } else {
    state.unclaimedSignificantTools += claim.ownedSequences.length
  }
}

export function claimIsCurrent(state: SessionState, claim: ClaimedCadence | ClaimedIdle | ClaimedRevalidation): boolean {
  return state.turnEpoch === claim.epoch
}

export function settleInFlight(
  state: SessionState,
  input: { checkID: string; outcome: "completed" | "cancelling" },
): "won" | "lost" {
  const inFlight = state.inFlight
  if (!inFlight || inFlight.checkID !== input.checkID) return "lost"
  if (input.outcome === "cancelling") {
    if (inFlight.settlement !== "active") return "lost"
    inFlight.settlement = "cancelling"
    return "won"
  }
  if (inFlight.settlement !== "active") return "lost"
  inFlight.settlement = "completed"
  return "won"
}

export function clearIdleAdmission(state: SessionState): void {
  if (state.idleAdmission?.timer) clearTimeout(state.idleAdmission.timer)
  state.idleAdmission = undefined
}
