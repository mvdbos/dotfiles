import { describe, expect, test } from "bun:test"
import {
  CONTEXT_THRESHOLD_RATIO,
  FINAL_SUMMARY_INSTRUCTION,
  InvocationBudgetStore,
  compareEstimate,
  estimateRequest,
  resolveModelBudget,
} from "./context-budget"

describe("model-derived context budgets", () => {
  test("uses 75 percent of the current 131072 context when output fills the remainder", () => {
    const budget = resolveModelBudget({ id: "local-a", limit: { context: 131_072, output: 32_768 } })

    expect(budget.thresholdTokens).toBe(98_304)
    expect(budget.usableInputTokens).toBe(98_304)
  })

  test("changes with smaller and larger models", () => {
    expect(resolveModelBudget({ limit: { context: 8_000, output: 1_000 } }).thresholdTokens).toBe(6_000)
    expect(resolveModelBudget({ limit: { context: 200_000, output: 10_000 } }).thresholdTokens).toBe(150_000)
  })

  test("honors a lower explicit input limit and output/headroom reservations", () => {
    const budget = resolveModelBudget(
      { limit: { context: 131_072, input: 50_000, output: 32_768 } },
      { summaryHeadroomTokens: 1_000 },
    )

    expect(budget.reservedTokens).toBe(21_000)
    expect(budget.usableInputTokens).toBe(29_000)
    expect(budget.thresholdTokens).toBe(29_000)
  })

  test("does not exhaust unknown or zero context limits", () => {
    for (const context of [undefined, 0]) {
      const budget = resolveModelBudget({ limit: { context } })
      expect(budget.enabled).toBe(false)
      expect(compareEstimate(budget, 1_000_000)).toBe("disabled")
    }
  })
})

describe("request estimation", () => {
  test("includes system material, messages, tools, arguments, results, errors, and attachments", () => {
    const estimate = estimateRequest({
      system: ["system instructions"],
      messages: [
        { role: "assistant", reasoning: "reasoning", toolCall: { name: "read", arguments: { path: "a.ts" } } },
        { role: "tool", name: "read", result: "new result", error: undefined },
      ],
      tools: [{ name: "read", parameters: { type: "object" } }],
      attachments: [{ mime: "text/plain", text: "attachment" }],
    })

    expect(estimate.serialized).toContain("new result")
    expect(estimate.serialized).toContain("a.ts")
    expect(estimate.tokens).toBeGreaterThan(0)
  })

  test("a fresh large tool result can cross the next-request threshold", () => {
    const budget = resolveModelBudget({ limit: { context: 100, output: 0 } })
    const before = estimateRequest({ messages: [{ role: "user", content: "small" }] })
    const after = estimateRequest({
      messages: [{ role: "user", content: "small" }, { role: "tool", result: "x".repeat(400) }],
    })

    expect(compareEstimate(budget, before)).toBe("safe")
    expect(compareEstimate(budget, after)).toBe("exhausted")
  })

  test("assistant tool-call arguments contribute to the estimate", () => {
    const short = estimateRequest({ messages: [{ role: "assistant", toolCall: { name: "read", arguments: {} } }] })
    const long = estimateRequest({
      messages: [{ role: "assistant", toolCall: { name: "read", arguments: { path: "x".repeat(200) } } }],
    })

    expect(long.tokens).toBeGreaterThan(short.tokens)
  })

  test("uses inclusive provider input usage without adding cache fields or history", () => {
    const material = { messages: [{ role: "user", content: "x" }] }
    const withoutUsage = estimateRequest(material)
    const withUsage = estimateRequest({
      ...material,
      providerUsage: { inputTokens: withoutUsage.serializedTokens + 10, cache: { read: 500, write: 200 } },
    })

    expect(withUsage.tokens).toBe(withoutUsage.serializedTokens + 10)
    expect(withUsage.tokens).not.toBe(withoutUsage.serializedTokens + 710)
  })

  test("does not sum historical usage across requests", () => {
    const estimate = estimateRequest({ providerUsage: { inputTokens: 100 } })
    expect(estimate.tokens).toBe(100)
  })

  test("does not depend on a global model identity", () => {
    const small = resolveModelBudget({ id: "resolved-small", limit: { context: 1_000, output: 100 } })
    const large = resolveModelBudget({ id: "resolved-large", limit: { context: 10_000, output: 100 } })

    expect(small.modelID).toBe("resolved-small")
    expect(large.modelID).toBe("resolved-large")
    expect(large.thresholdTokens).toBeGreaterThan(small.thresholdTokens ?? 0)
  })

  test("reaches exhaustion at and above the threshold", () => {
    const budget = resolveModelBudget({ limit: { context: 100, output: 0 } })
    expect(compareEstimate(budget, 74)).toBe("safe")
    expect(compareEstimate(budget, 75)).toBe("exhausted")
  })
})

describe("sticky invocation state", () => {
  test("marks once, stays exhausted, and keeps session state independent", () => {
    const store = new InvocationBudgetStore()
    const budget = resolveModelBudget({ limit: { context: 100, output: 0 } })

    expect(store.observe("a", budget, 75)).toBe("exhausted")
    expect(store.observe("a", budget, 1)).toBe("exhausted")
    expect(store.observe("b", budget, 1)).toBe("active")
    expect(store.markSummaryInjected("a")).toBe(true)
    expect(store.markSummaryInjected("a")).toBe(false)
    expect(store.summaryWasInjected("a")).toBe(true)
    expect(FINAL_SUMMARY_INSTRUCTION).toContain("Do not make further tool calls")
    expect(CONTEXT_THRESHOLD_RATIO).toBe(0.75)
  })

  test("resets only through genuine finish", () => {
    const store = new InvocationBudgetStore()
    const budget = resolveModelBudget({ limit: { context: 100, output: 0 } })

    store.observe("a", budget, 75)
    store.finish("a")
    expect(store.status("a")).toBeUndefined()
    expect(store.observe("a", budget, 1)).toBe("active")
  })
})
