/// <reference path="../../explore-controls/bun-shims.d.ts" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { api, createSession, promptAsync, startProbeInstance, waitFor, type ProbeInstance } from "./harness"
import { MIDRUN_PROBE_ADVISORY } from "./feedback-probe-plugin"

let instance: ProbeInstance

type ProviderMessage = Record<string, any>

function providerMessages(request: { body: Record<string, any> }): ProviderMessage[] {
  return Array.isArray(request.body.messages) ? request.body.messages : []
}

function toolMessage(messages: ProviderMessage[], callID: string) {
  return messages.find((message) => message.role === "tool" && message.tool_call_id === callID)
}

function textContent(message: ProviderMessage | undefined): string {
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) {
    return message.content.map((item: any) => (typeof item?.text === "string" ? item.text : "")).join("")
  }
  return ""
}

async function storedMessages(sessionID: string): Promise<Array<Record<string, any>>> {
  return api(instance, "GET", `/session/${sessionID}/message`)
}

async function runProbeTurn(sessionID: string) {
  instance.llm.mainScript = [
    { kind: "tool", tool: "bash", args: { command: "echo one" }, id: "call_1" },
    { kind: "tool", tool: "bash", args: { command: "echo two" }, id: "call_2" },
    { kind: "text", text: "Done." },
  ]
  instance.llm.mainRequests = 0
  const before = instance.llm.requestsOf("main").length
  await promptAsync(instance, sessionID, "run the probe turn")
  await waitFor("three main-model requests", () => instance.llm.requestsOf("main")[before + 2], 20_000)
  return {
    first: instance.llm.requestsOf("main")[before]!,
    second: instance.llm.requestsOf("main")[before + 1]!,
    third: instance.llm.requestsOf("main")[before + 2]!,
  }
}

beforeAll(async () => {
  instance = await startProbeInstance({
    pluginEntry: new URL("./feedback-probe-plugin.ts", import.meta.url).pathname,
    pluginExport: "MidrunFeedbackProbePlugin",
    env: { OPENCODE_LOG_LEVEL: "INFO" },
  })
}, 90_000)

afterAll(async () => {
  await instance?.stop()
})

describe("request-local mid-run feedback probe", () => {
  test("advisory reaches the next request, repeats byte-identically at the same boundary, and never persists", async () => {
    try {
      const sessionID = await createSession(instance, "midrun-probe")
      const requests = await runProbeTurn(sessionID)

      const firstTool = toolMessage(providerMessages(requests.first), "call_1")
      expect(textContent(firstTool)).not.toContain("watchdog advisory")

      const secondTool = toolMessage(providerMessages(requests.second), "call_1")
      expect(textContent(secondTool)).toContain(MIDRUN_PROBE_ADVISORY)
      expect(textContent(secondTool).endsWith(MIDRUN_PROBE_ADVISORY)).toBe(true)

      const thirdMessages = providerMessages(requests.third)
      const thirdTool = toolMessage(thirdMessages, "call_1")
      expect(textContent(thirdTool)).toBe(textContent(secondTool))
      const secondToolCallTwo = toolMessage(providerMessages(requests.second), "call_2")
      expect(textContent(secondToolCallTwo)).not.toContain("watchdog advisory")
      const thirdToolCallTwo = toolMessage(thirdMessages, "call_2")
      expect(textContent(thirdToolCallTwo)).not.toContain("watchdog advisory")

      const secondMessages = providerMessages(requests.second)
      const boundaryIndex = secondMessages.findIndex((message) => message.tool_call_id === "call_1" && message.role === "tool")
      expect(boundaryIndex).toBeGreaterThanOrEqual(0)
      expect(JSON.stringify(thirdMessages.slice(0, boundaryIndex + 1))).toBe(
        JSON.stringify(secondMessages.slice(0, boundaryIndex + 1)),
      )

      const stored = await storedMessages(sessionID)
      const serialized = JSON.stringify(stored)
      expect(serialized).not.toContain("watchdog advisory")
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 60_000)

  test("compaction never receives the advisory text or semantics", async () => {
    try {
      const sessionID = await createSession(instance, "midrun-compaction")
      await runProbeTurn(sessionID)
      await waitFor(
        "session idle after the probe turn",
        async () => {
          const messages = await storedMessages(sessionID)
          const assistants = messages.filter((message) => message.info?.role === "assistant")
          return assistants.at(-1)?.info?.time?.completed ? true : undefined
        },
        20_000,
        undefined,
      )

      instance.llm.mainScript = []
      instance.llm.mainRequests = 0
      const before = instance.llm.requestsOf("main").length
      await api(instance, "POST", `/session/${sessionID}/summarize`, {
        providerID: "probe",
        modelID: "main-model",
      })
      const summaryRequest = await waitFor("summarization request", () => instance.llm.requestsOf("main")[before], 20_000)
      const summaryMessages = providerMessages(summaryRequest)
      expect(JSON.stringify(summaryMessages)).not.toContain("watchdog advisory")

      const stored = await storedMessages(sessionID)
      const summaries = stored.filter((message) => message.info?.summary === true)
      expect(summaries.length).toBeGreaterThan(0)
      expect(JSON.stringify(summaries)).not.toContain("watchdog advisory")
    } catch (error) {
      writeFileSync("/tmp/watchdog-probe-logs.txt", instance.logs())
      throw error
    }
  }, 60_000)
})
