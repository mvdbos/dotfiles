import type { Plugin } from "@opencode-ai/plugin"
import {
  ExploreAdmissionCancelledError,
  ExploreAdmissionQueue,
  ExploreAdmissionTimeoutError,
  type ExploreLease,
} from "../explore-controls/concurrency-queue"

const TASK_TOOL = "task"
const EXPLORE_AGENT = "explore"

type RecordValue = Record<string, unknown>

type PendingAdmission = {
  key: string
  parentSessionID: string
  controller: AbortController
}

type Admission = PendingAdmission & {
  lease: ExploreLease
  childSessionID?: string
  background: boolean
}

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null ? (value as RecordValue) : undefined
}

function isAdmission(value: PendingAdmission | Admission): value is Admission {
  return "lease" in value
}

function admissionKey(sessionID: string, callID: string) {
  return `${sessionID}\u0000${callID}`
}

function eventProperties(input: unknown) {
  return record(record(input)?.properties)
}

function isExploreArgs(value: unknown) {
  return record(value)?.subagent_type === EXPLORE_AGENT
}

function sessionIDFromEvent(properties: RecordValue | undefined) {
  if (typeof properties?.sessionID === "string") return properties.sessionID
  const info = record(properties?.info)
  return typeof info?.id === "string" ? info.id : undefined
}

function partFromEvent(properties: RecordValue | undefined) {
  const part = record(properties?.part)
  if (!part || part.type !== "tool" || part.tool !== TASK_TOOL) return
  if (typeof part.sessionID !== "string" || typeof part.callID !== "string") return
  return { ...part, sessionID: part.sessionID, callID: part.callID, state: record(part.state) }
}

function metadataSessionID(output: unknown) {
  const metadata = record(record(output)?.metadata)
  return typeof metadata?.sessionId === "string" ? metadata.sessionId : undefined
}

function metadataIsBackground(output: unknown) {
  return record(record(output)?.metadata)?.background === true
}

function childInfo(value: unknown) {
  const info = record(record(value)?.info)
  if (!info || typeof info.id !== "string") return
  return {
    id: info.id,
    parentID: typeof info.parentID === "string" ? info.parentID : undefined,
    agent: typeof info.agent === "string" ? info.agent : undefined,
  }
}

function taskIDFromArgs(value: unknown) {
  const taskID = record(value)?.task_id
  return typeof taskID === "string" && taskID ? taskID : undefined
}

export const ExploreConcurrencyPlugin: Plugin = async ({ client }) => {
  const queue = new ExploreAdmissionQueue()
  const pending = new Map<string, PendingAdmission>()
  const admitted = new Map<string, Admission>()
  const children = new Map<string, Admission>()
  const direct = new Map<string, Admission>()

  const release = (admission: Admission) => {
    pending.delete(admission.key)
    admitted.delete(admission.key)
    if (admission.childSessionID && children.get(admission.childSessionID) === admission)
      children.delete(admission.childSessionID)
    if (direct.get(admission.parentSessionID) === admission) direct.delete(admission.parentSessionID)
    admission.lease.release()
  }

  const cancelPending = (item: PendingAdmission) => {
    item.controller.abort()
    pending.delete(item.key)
  }

  const linkChild = (admission: Admission, childSessionID: string, background = admission.background) => {
    if (admission.childSessionID && admission.childSessionID !== childSessionID) return false
    admission.childSessionID = childSessionID
    admission.background = background
    children.set(childSessionID, admission)
    return true
  }

  const findParentAdmission = (parentSessionID: string) => {
    for (const item of [...admitted.values(), ...pending.values()]) {
      if (item.parentSessionID === parentSessionID) return item
    }
    return undefined
  }

  const linkExistingChild = async (sessionID: string) => {
    try {
      const response = await client.session.get({ path: { id: sessionID } })
      const info = record((response as { data?: unknown }).data)
      const parentID = typeof info?.parentID === "string" ? info.parentID : undefined
      if (!parentID) return false
      const admission = findParentAdmission(parentID)
      if (!admission || !isAdmission(admission)) return false
      linkChild(admission, sessionID)
      return true
    } catch {
      return false
    }
  }

  const acquire = async (sessionID: string, callID: string) => {
    const key = admissionKey(sessionID, callID)
    const existing = admitted.get(key) ?? pending.get(key)
    if (existing) return isAdmission(existing) ? existing : undefined

    const controller = new AbortController()
    const item: PendingAdmission = { key, parentSessionID: sessionID, controller }
    pending.set(key, item)
    try {
      const lease = await queue.acquire(controller.signal)
      if (controller.signal.aborted) {
        lease.release()
        throw new ExploreAdmissionCancelledError()
      }
      const admission: Admission = { ...item, lease, background: false }
      pending.delete(key)
      admitted.set(key, admission)
      return admission
    } catch (error) {
      pending.delete(key)
      if (error instanceof ExploreAdmissionTimeoutError || error instanceof ExploreAdmissionCancelledError) throw error
      throw error
    }
  }

  return {
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: unknown }) => {
      if (input.tool !== TASK_TOOL || !isExploreArgs(output.args)) return
      const admission = await acquire(input.sessionID, input.callID)
      if (admission) admission.background = record(output.args)?.background === true
      const taskID = taskIDFromArgs(output.args)
      if (admission && taskID) linkChild(admission, taskID)
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: unknown,
    ) => {
      if (input.tool !== TASK_TOOL) return
      const admission = admitted.get(admissionKey(input.sessionID, input.callID))
      if (!admission) return

      const childSessionID = metadataSessionID(output)
      if (childSessionID) linkChild(admission, childSessionID, metadataIsBackground(output))
      if (!admission.background || !admission.childSessionID) release(admission)
    },

    "chat.message": async (
      input: { sessionID: string; agent?: string },
      output: { message: { agent?: string } },
    ) => {
      const agent = input.agent ?? output.message.agent
      if (agent !== EXPLORE_AGENT) return
      if (children.has(input.sessionID) || (await linkExistingChild(input.sessionID))) return

      const admission = await acquire(input.sessionID, `direct:${input.sessionID}`)
      if (!admission) return
      direct.set(input.sessionID, admission)
    },

    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const properties = eventProperties(event)
      if (event.type === "session.created") {
        const child = childInfo(properties)
        if (!child || !child.parentID) return
        if (child.agent && child.agent !== EXPLORE_AGENT) return
        const admission = findParentAdmission(child.parentID)
        if (admission && isAdmission(admission)) linkChild(admission, child.id)
        return
      }

      const part = partFromEvent(properties)
      if (part) {
        const key = admissionKey(part.sessionID, part.callID)
        const state = part.state?.status
        if (state === "error" || state === "completed") {
          const waiting = pending.get(key)
          if (waiting) cancelPending(waiting)
          const admission = admitted.get(key)
          if (admission && (!admission.background || !admission.childSessionID)) release(admission)
        }
      }

      const sessionID = sessionIDFromEvent(properties)
      if (!sessionID) return

      if (event.type === "session.idle") {
        const admission = direct.get(sessionID) ?? children.get(sessionID)
        if (admission && (direct.get(sessionID) === admission || admission.background)) release(admission)
        for (const item of pending.values()) {
          if (item.parentSessionID === sessionID) cancelPending(item)
        }
        return
      }

      if (event.type === "session.error") {
        for (const item of pending.values()) {
          if (item.parentSessionID === sessionID) cancelPending(item)
        }
        for (const item of [...admitted.values()]) {
          if (item.parentSessionID === sessionID && item.background && !item.childSessionID) release(item)
        }
        const admission = direct.get(sessionID) ?? children.get(sessionID)
        if (admission && (direct.get(sessionID) === admission || admission.background)) release(admission)
        return
      }

      if (event.type !== "session.deleted") return
      for (const item of pending.values()) {
        if (item.parentSessionID === sessionID) cancelPending(item)
      }
      const admission = direct.get(sessionID) ?? children.get(sessionID)
      if (admission) release(admission)
      for (const item of [...admitted.values()]) {
        if (item.parentSessionID === sessionID) release(item)
      }
    },

    dispose: async () => {
      for (const item of pending.values()) item.controller.abort()
      await Promise.resolve()
      for (const admission of admitted.values()) release(admission)
      queue.close()
    },
  }
}
