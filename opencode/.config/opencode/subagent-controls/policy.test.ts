import { afterEach, describe, expect, test } from "bun:test"
import { admissionPolicy, controlledSubagent, timeoutEnvironmentName } from "./policy"

const originalGeneralTimeout = process.env.OPENCODE_SUBAGENT_GENERAL_TIMEOUT_MS

afterEach(() => {
  if (originalGeneralTimeout === undefined) delete process.env.OPENCODE_SUBAGENT_GENERAL_TIMEOUT_MS
  else process.env.OPENCODE_SUBAGENT_GENERAL_TIMEOUT_MS = originalGeneralTimeout
})

describe("subagent admission policy", () => {
  test("uses per-agent defaults and environment overrides", () => {
    expect(admissionPolicy("explore")?.timeoutMs).toBe(60_000)
    expect(admissionPolicy("general")?.timeoutMs).toBe(600_000)
    expect(admissionPolicy("other")).toBeUndefined()

    process.env.OPENCODE_SUBAGENT_GENERAL_TIMEOUT_MS = "1234"
    expect(admissionPolicy("general")?.timeoutMs).toBe(1_234)
    expect(timeoutEnvironmentName("future-agent")).toBe("OPENCODE_SUBAGENT_FUTURE_AGENT_TIMEOUT_MS")
  })

  test("controls only explicit policy entries", () => {
    expect(controlledSubagent("general")).toBe(true)
    expect(controlledSubagent("toString")).toBe(false)
  })
})
