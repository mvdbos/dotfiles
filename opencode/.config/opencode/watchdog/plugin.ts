import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import {
  classifyUserMessage,
  userMessageText,
  type CompiledForeignPatterns,
} from "../plugin-generated-user/helpers"
import { buildCriticAgent, parseModelRef, PLAN_AGENT_NAME, WATCHDOG_AGENT_NAME, type WatchdogConfig } from "./config"
import { assistantTextFromPart, changeFingerprintFromTool, eventSessionID, isSignificantTool, terminalToolObservation } from "./collect"
import { CriticRunner } from "./critic"
import {
  buildIdlePromptBody,
  appendRunAdvisory,
} from "./feedback"
import { concernIdentity, decideDelivery, newDeliveryBudget, type AcceptedConcern } from "./noise"
import { fitUserPrompt, materializePacket, snapshotKey, evidenceFingerprint, type PacketTrigger, type WatchdogPacket } from "./packet"
import { CADENCE_ACTIVITY_TOAST_MS, CRITIC_SYSTEM_PROMPT, isCompletionCategory } from "./prompt"
import { rotateRoots, selectAdmissibleTrigger, type ExploreGate, type WatchdogLease } from "./scheduler"
import {
  applyForeignContinuation,
  applyWatchdogMessage,
  beginRealTurn,
  cadenceEligibleCount,
  claimCadence,
  claimIdle,
  claimRevalidation,
  clearIdleAdmission,
  createSessionState,
  deferClaim,
  isProtected,
  recordTool,
  settleClaim,
  settleInFlight,
  suppressWatchdog,
  type ClaimedCadence,
  type ClaimedIdle,
  type ClaimedRevalidation,
  type SessionState,
} from "./state"

export type WatchdogClient = {
  session: {
    get(options: { path: { id: string } }): Promise<{ data?: unknown; error?: unknown }>
    messages(options: {
      path: { id: string }
      query?: { limit?: number }
    }): Promise<{ data?: Array<{ info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }>; error?: unknown }>
    prompt(options: {
      path: { id: string }
      body: Record<string, unknown>
    }): Promise<{ data?: { info?: unknown; parts?: Array<Record<string, unknown>> }; error?: unknown }>
    abort(options: { path: { id: string } }): Promise<unknown>
    delete(options: { path: { id: string } }): Promise<unknown>
    create(options: { body: { parentID: string; title?: string } }): Promise<{ data?: { id?: string }; error?: unknown }>
  }
  tool: { ids(): Promise<{ data?: string[]; error?: unknown }> }
  tui: { showToast(options: { body: Record<string, unknown> }): Promise<unknown> }
  app: { log(options: { body: Record<string, unknown> }): Promise<unknown> }
}

export type WatchdogRuntimeDeps = {
  client: WatchdogClient
  config: WatchdogConfig
  patterns: CompiledForeignPatterns["patterns"]
  lease: WatchdogLease
  explore: ExploreGate
  log?: (message: string, detail?: unknown) => void
  now?: () => number
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type Trigger = ClaimedCadence | ClaimedIdle | ClaimedRevalidation
type PersistedUser = {
  messageID?: string
  kind: "real" | "watchdog" | "foreign"
  text: string
  agent?: unknown
  model?: unknown
}

export const DEFAULT_CIRCUIT_FAILURES = 3
export const CIRCUIT_OPEN_MS = 60_000

export class WatchdogRuntime {
  readonly states = new Map<string, SessionState>()
  readonly knownRoots = new Set<string>()
  readonly childSessions = new Set<string>()
  readonly tombstones = new Set<string>()
  readonly activeCriticSessions = new Set<string>()
  private readonly deps: WatchdogRuntimeDeps
  private readonly runner: CriticRunner
  private rotation = 0
  private disposed = false

  constructor(deps: WatchdogRuntimeDeps) {
    this.deps = deps
    this.runner = new CriticRunner({
      client: deps.client as never,
      onChildCreated: (id) => {
        this.activeCriticSessions.add(id)
        this.childSessions.add(id)
      },
      onChildDisposed: (id, deleted) => {
        this.activeCriticSessions.delete(id)
        this.childSessions.delete(id)
        if (!deleted) this.tombstones.add(id)
      },
      log: this.log.bind(this),
      debugLog: this.debugLog.bind(this),
    })
  }

  private log(message: string, detail?: unknown): void {
    if (this.deps.log) this.deps.log(message, detail)
    else void this.deps.client.app.log({ body: { service: "watchdog", level: "info", message, extra: detail === undefined ? undefined : { detail: String(detail) } } }).catch(() => {})
  }

  private telemetry(message: string, extra: Record<string, unknown>): void {
    if (!this.deps.config.debug) return
    void this.deps.client.app.log({
      body: { service: "watchdog", level: "info", message, extra },
    }).catch(() => {})
  }

  private debugLog(message: string, detail?: unknown): void {
    if (!this.deps.config.debug) return
    this.log(message, detail)
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private setTimer(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout> {
    return this.deps.setTimer ? this.deps.setTimer(callback, milliseconds) : setTimeout(callback, milliseconds)
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>): void {
    if (this.deps.clearTimer) this.deps.clearTimer(timer)
    else clearTimeout(timer)
  }

  stateFor(sessionID: string): SessionState {
    const existing = this.states.get(sessionID)
    if (existing) return existing
    const state = createSessionState()
    this.states.set(sessionID, state)
    this.enforceRootLimit()
    return state
  }

  get config(): WatchdogConfig {
    return this.deps.config
  }

  private enforceRootLimit(): void {
    const limit = 100
    if (this.states.size <= limit) return
    for (const [sessionID, state] of this.states) {
      if (isProtected(state)) continue
      this.states.delete(sessionID)
      this.knownRoots.delete(sessionID)
      if (this.states.size <= limit) return
    }
  }

  async markRootIfUnparented(sessionID: string): Promise<boolean> {
    if (this.knownRoots.has(sessionID)) return true
    if (this.childSessions.has(sessionID)) return false
    try {
      const response = await this.deps.client.session.get({ path: { id: sessionID } })
      const info = response.data as { parentID?: unknown } | undefined
      if (typeof info?.parentID === "string") {
        this.childSessions.add(sessionID)
        return false
      }
      this.knownRoots.add(sessionID)
      this.stateFor(sessionID)
      return true
    } catch {
      return false
    }
  }

  async handleChatMessage(input: {
    sessionID: string
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    messageID?: string
  }, output: { parts: Array<Record<string, unknown>> }): Promise<void> {
    if (this.disposed) return
    if (input.agent === WATCHDOG_AGENT_NAME) return
    if (input.agent === "explore") {
      this.deps.explore.markAdmitted(input.sessionID)
      return
    }
    if (this.childSessions.has(input.sessionID)) return
    if (!(await this.markRootIfUnparented(input.sessionID))) return

    const state = this.stateFor(input.sessionID)
    const restricted = input.agent === PLAN_AGENT_NAME
    const classification = classifyUserMessage({ parts: output.parts as never }, this.deps.patterns)

    if (classification.kind === "watchdog") {
      applyWatchdogMessage(state, input.messageID)
      return
    }
    if (classification.kind === "foreign") {
      applyForeignContinuation(state, classification.patternID ?? "foreign", input.messageID)
      if (state.inFlight?.trigger.kind === "idle") void this.cancelInFlight(state, "foreign")
      if (restricted) this.suppressForPlan(state)
      this.deps.explore.markEnded(input.sessionID)
      return
    }

    const text = userMessageText({ parts: output.parts as never })
    beginRealTurn(state, text, input.messageID)
    state.continuationClaim = undefined
    clearIdleAdmission(state)
    if (restricted) this.suppressForPlan(state)
  }

  private suppressForPlan(state: SessionState): void {
    suppressWatchdog(state)
    if (state.inFlight) void this.cancelInFlight(state, "plan")
  }

  async handleGoalPause(sessionID: string): Promise<void> {
    const state = this.states.get(sessionID)
    if (!state) return
    suppressWatchdog(state)
    if (state.inFlight) await this.cancelInFlight(state, "goal_paused")
  }

  recordTerminalTool(sessionID: string, part: Record<string, unknown>): void {
    if (this.disposed) return
    const state = this.states.get(sessionID)
    if (!state || state.suppressed) return
    const nextToolSeq = state.toolSeq + 1
    const observation = terminalToolObservation(part as never, nextToolSeq)
    if (!observation) return
    const change = changeFingerprintFromTool(observation, part as never)
    if (!recordTool(state, observation, change)) return
    state.toolSeq = nextToolSeq

    if (
      cadenceEligibleCount(state, this.deps.config.everyTools) >= this.deps.config.everyTools &&
      !state.pendingTrigger &&
      !state.inFlight
    ) {
      const claim = claimCadence(state, {
        everyTools: this.deps.config.everyTools,
        snapshotKey: this.currentSnapshotKey(state),
        maxRecentTools: this.deps.config.maxRecentTools,
      })
      if (claim) {
        state.pendingTrigger = claim
        void this.requestAdmission()
      }
    }
  }

  recordAssistantText(sessionID: string, messageID: string, text: string): void {
    const state = this.states.get(sessionID)
    if (!state || state.suppressed) return
    state.latestAssistantText = text
    state.latestAssistantMessageID = messageID
  }

  private currentSnapshotKey(state: SessionState): string {
    return snapshotKey(state.latestAssistantMessageID, state.taskMessageID, state.toolSeq)
  }

  handleIdle(sessionID: string): void {
    if (this.disposed) return
    const state = this.states.get(sessionID)
    if (!state || this.childSessions.has(sessionID)) return
    if (state.continuationClaim) {
      state.continuationClaim = undefined
      return
    }
    if (state.suppressed) return
    if (!this.deps.config.onIdle) return
    if (state.latestUserKind === "foreign") return
    if (state.continuationClaim) return
    if (state.circuitOpenUntil && this.now() < state.circuitOpenUntil) return

    const generation = (state.idleAdmission?.generation ?? 0) + 1
    clearIdleAdmission(state)
    const epoch = state.turnEpoch
    const timer = this.setTimer(() => {
      void this.fireIdle(sessionID, generation)
    }, this.deps.config.foreignContinuationSettleMs)
    state.idleAdmission = { generation, epoch, timer }
  }

  private async fireIdle(sessionID: string, generation: number): Promise<void> {
    const state = this.states.get(sessionID)
    if (!state || this.disposed) return
    const admission = state.idleAdmission
    if (!admission || admission.generation !== generation) return
    state.idleAdmission = undefined
    state.busy = false
    if (state.turnEpoch !== admission.epoch) return
    if (state.latestUserKind !== "real") return
    if (state.suppressed) return
    if (state.continuationClaim) return
    if (!(await this.markRootIfUnparented(sessionID))) return
    if (this.childSessions.has(sessionID)) return
    const persistedTurn = await this.latestPersistedUser(sessionID)
    if (
      state.turnEpoch !== admission.epoch ||
      state.suppressed ||
      state.latestUserKind !== "real" ||
      !this.matchesPersistedRealTurn(state, persistedTurn)
    ) {
      this.telemetry("watchdog idle review skipped", {
        sessionID,
        reason: "persisted_turn_changed",
        expectedMessageID: state.taskMessageID,
        latestMessageID: persistedTurn?.messageID,
        latestUserKind: persistedTurn?.kind,
      })
      return
    }

    const idleKey = snapshotKey(state.latestAssistantMessageID, this.currentSnapshotKey(state))
    if (state.lastIdleCheckKey === idleKey) return
    state.lastIdleCheckKey = idleKey

    const advisory = state.activeAdvisory
    if (advisory?.findingHash && advisory.installedAtEpoch === state.turnEpoch && advisory.deliveredAtEpoch !== state.turnEpoch) {
      state.pendingIdle = undefined
      void this.deliverIdleConcern(sessionID, state, advisory, advisory.findingHash, advisory.throughToolSeq)
      return
    }

    const claim = claimIdle(state, {
      idleKey,
      snapshotKey: this.currentSnapshotKey(state),
      maxRecentTools: this.deps.config.maxRecentTools,
    })
    state.pendingIdle = claim
    void this.requestAdmission()
  }

  async requestAdmission(): Promise<void> {
    try {
      await this.admit()
    } catch (error) {
      this.log("watchdog admission failed", error)
    }
  }

  private async admit(): Promise<void> {
    if (this.disposed) return
    if (this.deps.explore.isActive()) return
    const root = this.pickRoot()
    if (!root) return
    const state = this.states.get(root)!
    if (state.inFlight) return
    if (state.circuitOpenUntil && this.now() < state.circuitOpenUntil) return

    const selection = selectAdmissibleTrigger<Trigger>({
      idle: state.pendingIdle,
      revalidation: state.pendingRevalidation,
      cadence: state.pendingTrigger,
    })
    if (!selection) return

    if (selection.kind === "idle" && state.latestUserKind !== "real") return

    const lease = await this.deps.lease.tryAcquire()
    if (!lease) return
    if (state.suppressed) {
      this.deps.lease.release(lease)
      return
    }

    const claim = selection.trigger
    const trigger = claim.kind as PacketTrigger
    const packet = materializePacket(
      claim.evidence,
      trigger,
      { lastCheckToolSeq: state.lastCheckToolSeq, previousChangeHashes: state.previousChangeHashes },
      claim.kind === "revalidation" ? claim.candidate : undefined,
    )
    const fitted = fitUserPrompt(packet)
    if ("error" in fitted) {
      this.log("watchdog packet could not be bounded", fitted.error)
      this.deps.lease.release(lease)
      this.clearPending(state, claim)
      return
    }

    const abort = new AbortController()
    const checkID = `check-${this.now()}-${Math.floor(Math.random() * 1e6)}`
    this.clearPending(state, claim)
    state.inFlight = {
      checkID,
      epoch: state.turnEpoch,
      trigger: claim,
      settlement: "active",
      abort,
      lease,
      slowToastShown: false,
    }
    if (claim.kind === "cadence" && this.deps.config.debug) {
      state.inFlight.slowToastTimer = this.setTimer(() => {
        void this.showActivityToast(state, checkID)
      }, CADENCE_ACTIVITY_TOAST_MS)
    }

    const model = parseModelRef(this.deps.config.model)
    const startedAt = this.now()
    const run = this.runner.run({
      rootSessionID: root,
      agent: WATCHDOG_AGENT_NAME,
      model,
      prompt: fitted.prompt,
      ...(claim.kind === "cadence" || claim.kind === "idle" || claim.kind === "revalidation"
        ? {
            minimalPrompt: (() => {
              const minimal = fitUserPrompt(packet, { maxBytes: Math.min(6_000, 16_384) })
              return "error" in minimal ? fitted.prompt : minimal.prompt
            })(),
          }
        : {}),
      timeoutMs: this.deps.config.timeoutMs,
      signal: abort.signal,
    })
    state.inFlight.run = run

    const result = await run
    this.telemetry("watchdog check completed", {
      sessionID: root,
      checkID,
      trigger,
      outcome: result.kind,
      durationMs: Math.max(0, this.now() - startedAt),
      attempts: result.attempts,
      retryReasons: result.retryReasons,
      minimalRetry: result.minimalRetry,
    })
    await this.finishAttempt(root, state, checkID, claim, result, fitted.packet)
  }

  private reclaimCadenceIfEligible(state: SessionState): void {
    if (state.suppressed) return
    if (state.pendingTrigger) return
    if (cadenceEligibleCount(state, this.deps.config.everyTools) < this.deps.config.everyTools) return
    const claim = claimCadence(state, {
      everyTools: this.deps.config.everyTools,
      snapshotKey: this.currentSnapshotKey(state),
      maxRecentTools: this.deps.config.maxRecentTools,
    })
    if (claim) state.pendingTrigger = claim
  }

  private pickRoot(): string | undefined {
    const roots: string[] = []
    for (const [sessionID, state] of this.states) {
      if (this.childSessions.has(sessionID)) continue
      if (state.suppressed) continue
      if (state.pendingIdle || state.pendingRevalidation || state.pendingTrigger) {
        if (state.inFlight) continue
        roots.push(sessionID)
      }
    }
    if (roots.length === 0) return undefined
    roots.sort()
    const rotated = rotateRoots(roots, this.rotation)
    if (rotated) this.rotation = rotated.nextCursor
    return rotated?.root
  }

  private async showActivityToast(state: SessionState, checkID: string): Promise<void> {
    if (!this.deps.config.debug) return
    if (!state.inFlight || state.inFlight.checkID !== checkID) return
    if (state.inFlight.trigger.kind !== "cadence") return
    if (state.turnEpoch !== state.inFlight.epoch) return
    if (this.deps.explore.isActive()) return
    state.inFlight.slowToastShown = true
    try {
      await this.deps.client.tui.showToast({
        body: {
          title: "Watchdog",
          message: "Watchdog is reviewing recent progress in the background.",
          variant: "info",
          duration: 3000,
        },
      })
    } catch (error) {
      this.log("watchdog activity toast failed", error)
    }
  }

  private clearPending(state: SessionState, claim: Trigger): void {
    if (state.pendingIdle === claim) state.pendingIdle = undefined
    if (state.pendingTrigger === claim) state.pendingTrigger = undefined
    if (state.pendingRevalidation === claim) state.pendingRevalidation = undefined
  }

  private deferStaleConcern(
    state: SessionState,
    claim: Trigger,
    concern: AcceptedConcern,
    packetFingerprint: string,
  ): boolean {
    if (claim.epoch === state.turnEpoch) return false
    if (claim.kind !== "revalidation" && !state.pendingRevalidation) {
      const candidate = {
        severity: concern.severity,
        category: concern.category,
        message: concern.message,
        sourceEpoch: claim.epoch,
        evidenceFingerprint: packetFingerprint,
      }
      const revalidation = claimRevalidation(state, {
        candidate,
        snapshotKey: this.currentSnapshotKey(state),
        maxRecentTools: this.deps.config.maxRecentTools,
      })
      if (revalidation.revalidationKey !== state.lastRevalidationKey) {
        state.lastRevalidationKey = revalidation.revalidationKey
        state.pendingRevalidation = revalidation
      }
    }
    void this.requestAdmission()
    return true
  }

  private async finishAttempt(
    root: string,
    state: SessionState,
    checkID: string,
    claim: Trigger,
    result: Awaited<ReturnType<CriticRunner["run"]>>,
    packet: WatchdogPacket,
  ): Promise<void> {
    const won = settleInFlight(state, { checkID, outcome: "completed" })
    if (won === "lost") return

    if (state.inFlight?.slowToastTimer) this.clearTimer(state.inFlight.slowToastTimer)
    const lease = state.inFlight?.lease
    state.inFlight = undefined
    if (lease) this.deps.lease.release(lease)

    const completed = result.kind === "ok" || result.kind === "concern" || result.kind === "malformed"
    const newToolsDuringFlight = state.unclaimedSignificantTools
    settleClaim(state, claim, completed)
    if (newToolsDuringFlight > 0) this.reclaimCadenceIfEligible(state)

    if (state.suppressed) {
      this.telemetry("watchdog check dropped", {
        sessionID: root,
        checkID,
        trigger: claim.kind,
        reason: "plan_mode",
      })
      void this.requestAdmission()
      return
    }

    if (
      result.kind === "timeout" ||
      result.kind === "error" ||
      result.kind === "context_overflow" ||
      result.kind === "cancelled" ||
      result.kind === "malformed"
    ) {
      this.log(
        `watchdog critic result ${result.kind}`,
        result.kind === "malformed" ? `${result.detail}: ${result.raw.slice(0, 200)}` : result.detail,
      )
      state.consecutiveFailures += 1
      state.lastFailureAt = this.now()
      if (state.consecutiveFailures >= DEFAULT_CIRCUIT_FAILURES) {
        state.circuitOpenUntil = this.now() + CIRCUIT_OPEN_MS
      }
      void this.requestAdmission()
      return
    }
    state.consecutiveFailures = 0

    if (result.kind !== "concern") {
      void this.requestAdmission()
      return
    }

    const concern = result.concern
    if (claim.kind === "cadence" && isCompletionCategory(concern.category)) {
      this.telemetry("watchdog concern dropped", {
        sessionID: root,
        checkID,
        trigger: claim.kind,
        reason: "cadence_completion_category",
        category: concern.category,
      })
      void this.requestAdmission()
      return
    }
    const hash = concernIdentity(concern.category, concern.message)
    const packetFingerprint = evidenceFingerprint(packet)

    if (this.deferStaleConcern(state, claim, concern, packetFingerprint)) return

    const persistedTurn = await this.latestPersistedUser(root)
    if (state.suppressed) {
      this.telemetry("watchdog check dropped", {
        sessionID: root,
        checkID,
        trigger: claim.kind,
        reason: "plan_mode",
      })
      void this.requestAdmission()
      return
    }
    if (this.deferStaleConcern(state, claim, concern, packetFingerprint)) return
    if (!this.matchesPersistedDeliveryTurn(state, persistedTurn)) {
      this.telemetry("watchdog concern discarded", {
        sessionID: root,
        checkID,
        trigger: claim.kind,
        reason: "persisted_turn_changed",
        expectedMessageID: state.taskMessageID,
        latestMessageID: persistedTurn?.messageID,
        latestUserKind: persistedTurn?.kind,
      })
      void this.requestAdmission()
      return
    }

    const decision = decideDelivery({
      budget: state.deliveryBudget,
      severity: concern.severity,
      concernHash: hash,
      deliveredHashes: new Set(state.deliveredConcernHashes.values()),
      evidenceChanged: state.lastConcernEvidenceFingerprint !== packetFingerprint,
      toolsSinceLastConcern: Math.max(0, state.toolSeq - state.lastConcernToolSeq),
    })
    if (!decision.deliver) {
      void this.requestAdmission()
      return
    }

    state.deliveryBudget = decision.nextBudget
    state.deliveredConcernHashes.add(hash)
    state.lastConcernToolSeq = state.toolSeq
    state.lastConcernEvidenceFingerprint = packetFingerprint
    state.previousConcern = { category: concern.category, message: concern.message, evidenceFingerprint: packetFingerprint }

    if (state.latestUserKind === "foreign") {
      this.retainAdvisory(state, concern, hash, claim.throughToolSeq, claim.kind)
      void this.requestAdmission()
      return
    }
    if (state.latestUserKind !== "real") {
      void this.requestAdmission()
      return
    }

    if (!state.busy && state.pendingIdle) {
      const pendingIdle = state.pendingIdle
      const ownedSequences = pendingIdle.ownedSequences.filter((seq) => seq > state.lastCheckToolSeq)
      if (ownedSequences.length > 0) {
        deferClaim(state, { ...pendingIdle, claimedToolCount: ownedSequences.length, ownedSequences })
      } else {
        state.pendingIdle = undefined
      }
      void this.deliverIdleConcern(root, state, concern, hash, claim.throughToolSeq, claim.kind)
      return
    }

    if (claim.kind === "cadence" && this.deps.config.midRunDelivery) {
      this.retainAdvisory(state, concern, hash, claim.throughToolSeq, claim.kind)
      void this.requestAdmission()
      return
    }

    if (claim.kind === "cadence" || (state.busy && claim.kind !== "idle")) {
      this.retainAdvisory(state, concern, hash, claim.throughToolSeq, claim.kind)
      void this.requestAdmission()
      return
    }

    void this.deliverIdleConcern(root, state, concern, hash, claim.throughToolSeq, claim.kind)
    void this.requestAdmission()
  }

  private retainAdvisory(
    state: SessionState,
    concern: AcceptedConcern,
    findingHash: string,
    throughToolSeq: number,
    claimKind?: PacketTrigger,
  ): void {
    state.activeAdvisory = {
      ...concern,
      installedAtEpoch: state.turnEpoch,
      throughToolSeq,
      claimKind,
    }
    state.activeAdvisory.findingHash = findingHash
  }

  private async deliverIdleConcern(
    root: string,
    state: SessionState,
    concern: AcceptedConcern,
    findingHash: string,
    throughToolSeq: number,
    claimKind?: PacketTrigger,
  ): Promise<void> {
    if (state.continuationClaim) return
    if (state.suppressed) return
    const epoch = state.turnEpoch
    state.continuationClaim = { epoch, findingHash }
    const latest = await this.latestPersistedUser(root)
    if (
      !latest ||
      state.suppressed ||
      !this.matchesPersistedRealTurn(state, latest) ||
      state.turnEpoch !== epoch ||
      state.latestUserKind !== "real"
    ) {
      state.continuationClaim = undefined
      return
    }
    const body = buildIdlePromptBody({
      message: concern.message,
      ...(typeof latest.agent === "string" ? { agent: latest.agent } : {}),
      ...(latest.model ? { model: latest.model as { providerID: string; modelID: string } } : {}),
      findingHash,
      turnEpoch: epoch,
    })
    if (!state.activeAdvisory) this.retainAdvisory(state, concern, findingHash, throughToolSeq, claimKind)
    if (state.activeAdvisory) state.activeAdvisory.deliveredAtEpoch = epoch
    try {
      await this.deps.client.session.prompt({ path: { id: root }, body: { ...body } })
    } catch (error) {
      this.log("watchdog idle follow-up failed", error)
      state.continuationClaim = undefined
    }
  }

  private async latestPersistedUser(
    sessionID: string,
  ): Promise<PersistedUser | undefined> {
    try {
      const response = await this.deps.client.session.messages({ path: { id: sessionID }, query: { limit: 30 } })
      const messages = response.data ?? []
      const user = messages.filter((message) => message.info?.role === "user").at(-1)
      if (!user) return undefined
      const classification = classifyUserMessage({ parts: (user.parts ?? []) as never }, this.deps.patterns)
      return {
        ...(typeof user.info?.id === "string" ? { messageID: user.info.id } : {}),
        kind: classification.kind,
        text: userMessageText({ parts: (user.parts ?? []) as never }),
        agent: user.info?.agent,
        model: user.info?.model,
      }
    } catch {
      return undefined
    }
  }

  private matchesPersistedRealTurn(
    state: SessionState,
    latest: PersistedUser | undefined,
  ): boolean {
    if (!latest?.messageID || latest.kind !== "real") return false
    if (state.taskMessageID) return latest.messageID === state.taskMessageID
    if (!state.currentTask || latest.text !== state.currentTask) return false
    state.taskMessageID = latest.messageID
    state.latestUserMessageID = latest.messageID
    return true
  }

  private matchesPersistedDeliveryTurn(state: SessionState, latest: PersistedUser | undefined): boolean {
    if (this.matchesPersistedRealTurn(state, latest)) return true
    return Boolean(
      state.latestUserKind === "foreign" &&
      state.latestUserMessageID &&
      latest?.kind === "foreign" &&
      latest.messageID === state.latestUserMessageID,
    )
  }

  deliverPendingAdvisory(sessionID: string, tool: string, output: { output: string }): void {
    const state = this.states.get(sessionID)
    const advisory = state?.activeAdvisory
    if (!state || !advisory || state.suppressed || !this.deps.config.midRunDelivery) return
    if (advisory.installedAtEpoch !== state.turnEpoch || advisory.deliveredAtEpoch === state.turnEpoch) return
    if (!isSignificantTool(tool) || /^mcp(?:[_.:-]|$)/i.test(tool)) return

    const delivered = appendRunAdvisory(output.output, advisory.message)
    output.output = delivered.output
    advisory.deliveredAtEpoch = state.turnEpoch
  }

  observeSessionCreated(info: { id?: unknown; parentID?: unknown; agent?: unknown }): void {
    if (typeof info.id !== "string") return
    if (typeof info.parentID === "string") {
      this.childSessions.add(info.id)
      return
    }
    this.knownRoots.add(info.id)
    this.stateFor(info.id)
  }

  observeSessionDeleted(sessionID: string): void {
    this.childSessions.delete(sessionID)
    this.deps.explore.markEnded(sessionID)
    const state = this.states.get(sessionID)
    if (state?.inFlight) void this.cancelInFlight(state, "deleted")
    this.states.delete(sessionID)
    this.knownRoots.delete(sessionID)
  }

  async cancelInFlight(state: SessionState, reason: string): Promise<void> {
    const inFlight = state.inFlight
    if (!inFlight) return
    if (settleInFlight(state, { checkID: inFlight.checkID, outcome: "cancelling" }) !== "won") return
    if (inFlight.slowToastTimer) this.clearTimer(inFlight.slowToastTimer)
    inFlight.abort.abort()

    let confirmTimer: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([
      Promise.resolve(inFlight.run).then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        confirmTimer = this.setTimer(() => resolve(false), this.deps.config.timeoutMs + 500)
      }),
    ])
    if (confirmTimer) this.clearTimer(confirmTimer)

    if (state.inFlight?.checkID !== inFlight.checkID) return
    if (!settled) {
      this.debugLog(`watchdog check cancellation unconfirmed (${reason}); lease retained`)
      return
    }

    state.inFlight.settlement = "completed"
    this.clearPending(state, inFlight.trigger)
    deferClaim(state, inFlight.trigger)
    state.inFlight = undefined
    if (inFlight.lease) this.deps.lease.release(inFlight.lease)
    this.reclaimCadenceIfEligible(state)
    this.debugLog(`watchdog check cancelled (${reason})`)
  }

  async preemptForExplore(): Promise<void> {
    if (!this.deps.explore.isActive()) return
    for (const state of this.states.values()) {
      if (state.inFlight) await this.cancelInFlight(state, "explore")
    }
  }

  get exploreGate(): ExploreGate {
    return this.deps.explore
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const state of this.states.values()) {
      clearIdleAdmission(state)
      if (state.inFlight) {
        if (state.inFlight.slowToastTimer) this.clearTimer(state.inFlight.slowToastTimer)
        state.inFlight.abort.abort()
        if (state.inFlight.lease) this.deps.lease.release(state.inFlight.lease)
        state.inFlight = undefined
      }
    }
    this.states.clear()
    this.knownRoots.clear()
    this.childSessions.clear()
  }
}

export function watchdogAgentConfig(config: WatchdogConfig): Record<string, unknown> {
  return buildCriticAgent(config)
}

export function createWatchdogHooks(runtime: WatchdogRuntime): Hooks {
  return {
    config: async (input) => {
      input.agent = { ...(input.agent ?? {}), [WATCHDOG_AGENT_NAME]: buildCriticAgent(runtime.config) }
    },
    "chat.params": async (input, output) => {
      if (input.agent !== WATCHDOG_AGENT_NAME) return
      if (!runtime.activeCriticSessions.has(input.sessionID)) return
      output.maxOutputTokens = 256
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID || !runtime.activeCriticSessions.has(input.sessionID)) return
      output.system.splice(0, output.system.length, CRITIC_SYSTEM_PROMPT)
    },
    "chat.message": async (input, output) => {
      const outputMessageID = (output.message as { id?: unknown }).id
      await runtime.handleChatMessage(
        {
          ...input,
          ...(typeof input.messageID === "string"
            ? { messageID: input.messageID }
            : typeof outputMessageID === "string"
              ? { messageID: outputMessageID }
              : {}),
        },
        { parts: output.parts as unknown as Array<Record<string, unknown>> },
      )
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") return
      const args = output.args as { subagent_type?: unknown } | undefined
      if (args?.subagent_type !== "explore") return
      runtime.exploreGate.markAdmitted(`pending:${input.callID}`)
      await runtime.preemptForExplore()
    },
    "tool.execute.after": async (input, output) => {
      if (runtime.activeCriticSessions.has(input.sessionID)) return
      const goalStatus = (input.args as { status?: unknown } | undefined)?.status
      if (input.tool === "update_goal_status" && goalStatus === "paused") {
        await runtime.handleGoalPause(input.sessionID)
        return
      }
      runtime.deliverPendingAdvisory(input.sessionID, input.tool, output)
      if (input.tool !== "task") return
      const args = input.args as { subagent_type?: unknown; background?: unknown } | undefined
      if (args?.subagent_type === "explore" && args.background !== true) {
        runtime.exploreGate.markEnded(`pending:${input.callID}`)
      }
    },
    event: async ({ event }) => {
      const sessionID = eventSessionID(event as never)
      if (event.type === "session.created") {
        runtime.observeSessionCreated((event.properties as { info?: Record<string, unknown> }).info ?? {})
        return
      }
      if (event.type === "session.deleted") {
        const info = (event.properties as { info?: { id?: unknown } }).info
        if (typeof info?.id === "string") runtime.observeSessionDeleted(info.id)
        return
      }
      if (event.type === "session.idle") {
        if (sessionID) {
          const state = runtime.states.get(sessionID)
          if (state) state.busy = false
          runtime.exploreGate.markEnded(sessionID)
          runtime.handleIdle(sessionID)
        }
        return
      }
      if (event.type === "session.status") {
        const status = (event.properties as { status?: { type?: unknown } }).status
        if (sessionID) {
          const state = runtime.states.get(sessionID)
          if (state) state.busy = status?.type === "busy" || status?.type === "retry"
        }
        if (status?.type === "idle" && sessionID) runtime.handleIdle(sessionID)
        return
      }
      if (event.type === "todo.updated") {
        if (!sessionID) return
        const state = runtime.states.get(sessionID)
        if (!state) return
        const todos = (event.properties as { todos?: unknown }).todos
        state.todos = Array.isArray(todos)
          ? todos
              .filter(
                (todo): todo is { content: string; status: string; priority: string } =>
                  typeof todo === "object" &&
                  todo !== null &&
                  typeof (todo as Record<string, unknown>).content === "string" &&
                  typeof (todo as Record<string, unknown>).status === "string" &&
                  typeof (todo as Record<string, unknown>).priority === "string",
              )
              .map((todo) => ({ content: todo.content, status: todo.status, priority: todo.priority }))
          : []
        return
      }
      if (event.type === "message.part.updated") {
        const part = (event.properties as { part?: Record<string, unknown> }).part
        if (!part) return
        const partSessionID = typeof part.sessionID === "string" ? part.sessionID : sessionID
        if (!partSessionID) return
        if (part.type === "tool") {
          runtime.recordTerminalTool(partSessionID, part)
          return
        }
        if (part.type === "text") {
          const text = assistantTextFromPart(part)
          const messageID = typeof part.messageID === "string" ? part.messageID : undefined
          if (text && messageID) runtime.recordAssistantText(partSessionID, messageID, text)
        }
      }
    },
    dispose: async () => {
      await runtime.dispose()
    },
  }
}
