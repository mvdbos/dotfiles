/// <reference path="../explore-controls/bun-shims.d.ts" />

import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { formatReport, summarize, type ProbeRun } from "./helpers"
import { PROBE_CUES } from "./cues"
import {
  cleanupProbe,
  OPENCODE_BIN,
  probeAvailable,
  readRealSetup,
  startProbeInstance,
  type ProbeInstance,
  type RealSetup,
} from "./harness"
import { runProbe } from "./probe"

const enabled = process.env.TOOL_SELECTION_PROBE_LIVE === "1"
const repetitions = Number(process.env.PROBE_REPS ?? "3")
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS ?? "240000")
const filtered = process.env.PROBE_CUES?.split(",")
  .map((id) => id.trim())
  .filter(Boolean)
const cues = filtered?.length ? PROBE_CUES.filter((cue) => filtered.includes(cue.id)) : PROBE_CUES

type Detection = { ok: true; setup: RealSetup } | { ok: false; reason: string }

const detection: Detection = await (async () => {
  if (!enabled) return { ok: false, reason: "set TOOL_SELECTION_PROBE_LIVE=1 to run" }
  if (!existsSync(OPENCODE_BIN)) return { ok: false, reason: `opencode binary not found at ${OPENCODE_BIN}` }
  try {
    const setup = await readRealSetup()
    const availability = await probeAvailable(setup.baseURL)
    if (!availability.ok) return { ok: false, reason: availability.reason ?? "probe model unavailable" }
    return { ok: true, setup }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
})()

if (enabled && !detection.ok) console.log(`tool-selection probe skipped: ${detection.reason}`)

const maybe = detection.ok ? test : test.skip

let booting: Promise<ProbeInstance> | undefined
let runs: ProbeRun[] = []

afterAll(async () => {
  await cleanupProbe(await booting)
})

maybe(
  `local primary agent routes work to the right tools (${detection.ok ? detection.setup.modelRef : "skipped"})`,
  async () => {
    if (!detection.ok) return
    const started = Date.now()
    const host = await (booting ??= startProbeInstance(detection.setup))
    runs = await runProbe({
      host,
      cues,
      repetitions,
      timeoutMs,
      onRun: (run) => {
        const task = run.evidence.taskCalls.map((call) => call.subagent).join(",")
        const outcome = task || (run.evidence.questionCalls.length > 0 ? "question" : "direct")
        console.log(`  ${run.cue}#${run.repetition} -> ${outcome} (${(run.elapsedMs / 1000).toFixed(1)}s)`)
      },
    })

    const report = formatReport(
      { model: detection.setup.modelRef, configDir: detection.setup.configDir, repetitions },
      cues,
      runs,
    )
    console.log(`\n${report}\n`)
    if (process.env.PROBE_REPORT) await writeFile(process.env.PROBE_REPORT, `${report}\n`)

    const failing = summarize(cues, runs)
      .filter((row) => !row.majority)
      .map((row) => `${row.id} ${row.passes}/${row.runs}`)
    expect(failing).toEqual([])
    console.log(`probe finished in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  },
  repetitions * cues.length * (timeoutMs + 30_000) + 120_000,
)
