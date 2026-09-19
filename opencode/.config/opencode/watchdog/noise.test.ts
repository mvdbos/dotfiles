/// <reference path="../explore-controls/bun-shims.d.ts" />

import { describe, expect, test } from "bun:test"
import {
  concernIdentity,
  decideDelivery,
  isContentFreeMessage,
  newDeliveryBudget,
  normalizeConcernText,
  parseCriticOutput,
} from "./noise"

describe("parseCriticOutput", () => {
  test("accepts exactly ok", () => {
    expect(parseCriticOutput('{"status":"ok"}')).toEqual({ kind: "ok" })
  })

  test("tolerates extra keys on ok and concern output", () => {
    expect(parseCriticOutput('{"status":"ok","message":"hi"}')).toEqual({ kind: "ok" })
    expect(parseCriticOutput('{"status":"ok","evidenceFingerprint":"abc","nextStep":"none"}')).toEqual({ kind: "ok" })
    const echoed = parseCriticOutput(
      JSON.stringify({
        status: "concern",
        severity: "warning",
        category: "missing_verification",
        message: "Tests failed after the change and no verification was recorded.",
        confidence: 0.9,
        nextStep: "Run the failing test again.",
      }),
    )
    expect(echoed).toMatchObject({
      kind: "concern",
      concern: { severity: "warning", category: "missing_verification" },
    })
  })

  test("extracts the JSON object from fences, prose, and trailing text", () => {
    const concern = JSON.stringify({
      status: "concern",
      severity: "warning",
      category: "repeated_failure",
      message: "The same failing test command was re-run three times with identical errors.",
    })
    expect(parseCriticOutput(`\`\`\`json\n${concern}\n\`\`\``)).toMatchObject({ kind: "concern" })
    expect(parseCriticOutput(`Here is my verdict:\n${concern}\nDone.`)).toMatchObject({ kind: "concern" })
    expect(parseCriticOutput('Verdict: {"status":"ok"} — nothing to report.')).toEqual({ kind: "ok" })
  })

  test("keeps braces inside strings from breaking extraction", () => {
    const concern = JSON.stringify({
      status: "concern",
      severity: "warning",
      category: "contradicted_evidence",
      message: 'The template "{not json}" was emitted while the tool output shows an error.',
    })
    expect(parseCriticOutput(concern)).toMatchObject({ kind: "concern" })
  })

  test("accepts one schema-valid bounded concern", () => {
    const result = parseCriticOutput(
      JSON.stringify({
        status: "concern",
        severity: "warning",
        category: "repeated_failure",
        message: "The same failing test command was re-run three times with identical errors.",
      }),
    )
    expect(result).toEqual({
      kind: "concern",
      concern: {
        severity: "warning",
        category: "repeated_failure",
        message: "The same failing test command was re-run three times with identical errors.",
      },
    })
  })

  test("tolerates benign extra keys but rejects bad enums, short and oversized messages", () => {
    const base = { status: "concern", severity: "warning", category: "plan_drift", message: "A concrete enough message." }
    expect(parseCriticOutput(JSON.stringify({ ...base, confidence: 0.9 }))).toMatchObject({ kind: "concern" })
    expect(parseCriticOutput(JSON.stringify({ ...base, severity: "fatal" }))).toMatchObject({ kind: "malformed" })
    expect(parseCriticOutput(JSON.stringify({ ...base, category: "style" }))).toMatchObject({ kind: "malformed" })
    expect(parseCriticOutput(JSON.stringify({ ...base, message: "too short" }))).toMatchObject({ kind: "malformed" })
    expect(
      parseCriticOutput(JSON.stringify({ ...base, message: "x".repeat(501) })),
    ).toMatchObject({ kind: "malformed" })
  })

  test("rejects content-free and non-JSON output", () => {
    expect(
      parseCriticOutput('{"status":"concern","severity":"warning","category":"plan_drift","message":"Be careful here."}'),
    ).toMatchObject({ kind: "malformed" })
    expect(parseCriticOutput("I think you should check things.")).toMatchObject({ kind: "malformed" })
    expect(parseCriticOutput("")).toMatchObject({ kind: "malformed" })
    expect(parseCriticOutput("[1,2,3]")).toMatchObject({ kind: "malformed" })
  })

  test("rejects assistant output above the byte budget even when JSON is valid", () => {
    const message = "é".repeat(1001)
    expect(Buffer.byteLength(message, "utf8")).toBeGreaterThan(2000)
    expect(
      parseCriticOutput(JSON.stringify({ status: "concern", severity: "warning", category: "plan_drift", message })),
    ).toMatchObject({ kind: "malformed", reason: "critic output exceeded the assistant byte budget" })
  })

  test("accepts multibyte and emoji concern messages without byte/character confusion", () => {
    const message = "The 测试 file was renamed while the endpoint 🚀 stayed documented as required."
    const result = parseCriticOutput(
      JSON.stringify({ status: "concern", severity: "critical", category: "requirement_drift", message }),
    )
    expect(result).toEqual({
      kind: "concern",
      concern: { severity: "critical", category: "requirement_drift", message },
    })
  })
})

describe("content-free detection", () => {
  test("rejects generic phrases after normalization", () => {
    for (const message of ["ok", "Okay", "Looks good!", "be careful", "VERIFY", "please   reconsider", "Nothing"]) {
      expect(isContentFreeMessage(message)).toBe(true)
    }
  })

  test("accepts evidence-bearing sentences", () => {
    expect(isContentFreeMessage("The migration command deleted the production table without a backup.")).toBe(false)
    expect(isContentFreeMessage("Test suite still fails after the rename, matching the earlier error.")).toBe(false)
  })
})

describe("concern identity", () => {
  test("normalizes case, punctuation, whitespace, and width", () => {
    const a = concernIdentity("plan_drift", "The PLAN drifted: step 2 was dropped!")
    const b = concernIdentity("plan_drift", "the plan   drifted step 2 was dropped")
    expect(a).toBe(b)
    expect(normalizeConcernText("Ｆｕｌｌｗｉｄｔｈ")).toBe("fullwidth")
  })

  test("separates categories with identical messages", () => {
    expect(concernIdentity("plan_drift", "The plan drifted mid task")).not.toBe(
      concernIdentity("requirement_drift", "The plan drifted mid task"),
    )
  })
})

describe("delivery budget", () => {
  const concern = (overrides: Partial<Parameters<typeof decideDelivery>[0]> = {}) => ({
    budget: newDeliveryBudget(),
    severity: "warning" as const,
    concernHash: "hash-a",
    deliveredHashes: new Set<string>(),
    evidenceChanged: true,
    toolsSinceLastConcern: 0,
    ...overrides,
  })

  test("first warning is delivered and consumes the base budget", () => {
    const decision = decideDelivery(concern())
    expect(decision.deliver).toBe(true)
    expect(decision.nextBudget).toEqual({
      baseDeliveryUsed: true,
      criticalEscalationUsed: false,
      baseSeverity: "warning",
    })
  })

  test("warning then independent critical on changed evidence delivers exactly once", () => {
    const first = decideDelivery(concern())
    const second = decideDelivery(
      concern({
        budget: first.nextBudget,
        severity: "critical",
        concernHash: "hash-b",
        deliveredHashes: new Set(["hash-a"]),
      }),
    )
    expect(second.deliver).toBe(true)
    expect(second.reason).toBe("escalation")
    const third = decideDelivery(
      concern({
        budget: second.nextBudget,
        severity: "critical",
        concernHash: "hash-c",
        deliveredHashes: new Set(["hash-a", "hash-b"]),
      }),
    )
    expect(third.deliver).toBe(false)
    expect(third.reason).toBe("budget")
  })

  test("critical first consumes both budgets and suppresses later warnings", () => {
    const first = decideDelivery(concern({ severity: "critical" }))
    expect(first.deliver).toBe(true)
    expect(first.nextBudget).toEqual({
      baseDeliveryUsed: true,
      criticalEscalationUsed: true,
      baseSeverity: "critical",
    })
    const second = decideDelivery(
      concern({
        budget: first.nextBudget,
        severity: "warning",
        concernHash: "hash-b",
        deliveredHashes: new Set(["hash-a"]),
      }),
    )
    expect(second.deliver).toBe(false)
  })

  test("duplicate requires both the new-tool cooldown and changed evidence", () => {
    const budget = { baseDeliveryUsed: true, criticalEscalationUsed: false, baseSeverity: "warning" as const }
    const delivered = new Set(["hash-a"])
    expect(
      decideDelivery(concern({ budget, deliveredHashes: delivered, toolsSinceLastConcern: 4 })).deliver,
    ).toBe(false)
    expect(
      decideDelivery(concern({ budget, deliveredHashes: delivered, toolsSinceLastConcern: 5, evidenceChanged: false }))
        .deliver,
    ).toBe(false)
    expect(
      decideDelivery(concern({ budget, deliveredHashes: delivered, toolsSinceLastConcern: 5, evidenceChanged: true }))
        .deliver,
    ).toBe(false)
  })

  test("changed evidence does not bypass the budget for a fresh warning", () => {
    const budget = { baseDeliveryUsed: true, criticalEscalationUsed: false, baseSeverity: "warning" as const }
    const decision = decideDelivery(
      concern({ budget, severity: "warning", concernHash: "hash-new", deliveredHashes: new Set(["hash-a"]) }),
    )
    expect(decision.deliver).toBe(false)
    expect(decision.reason).toBe("budget")
  })

  test("a duplicate hash can be re-delivered only after cooldown and evidence change but budget still gates", () => {
    const budget = newDeliveryBudget()
    const decision = decideDelivery(
      concern({ budget, deliveredHashes: new Set(["hash-a"]), toolsSinceLastConcern: 6, evidenceChanged: true }),
    )
    expect(decision.deliver).toBe(true)
  })
})
