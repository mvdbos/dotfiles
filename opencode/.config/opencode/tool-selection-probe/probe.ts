import { evidenceOf, type ProbeCue, type ProbeRun } from "./helpers"
import { abortSession, createSession, messages, promptAsync, sleep, type ProbeInstance } from "./harness"

export type ProbeOptions = {
  host: ProbeInstance
  cues: ProbeCue[]
  repetitions: number
  timeoutMs: number
  pollMs?: number
  onRun?: (run: ProbeRun) => void
}

export async function runCue(
  host: ProbeInstance,
  cue: ProbeCue,
  repetition: number,
  timeoutMs: number,
  pollMs = 1000,
): Promise<ProbeRun> {
  const sessionID = await createSession(host, `probe ${cue.id} #${repetition}`)
  const started = Date.now()
  await promptAsync(host, sessionID, cue.prompt)

  const deadline = started + timeoutMs
  let aborted = false
  while (Date.now() < deadline) {
    const evidence = evidenceOf(await messages(host, sessionID))
    if (evidence.questionCalls.length > 0) {
      await sleep(1200)
      await abortSession(host, sessionID)
      aborted = true
      break
    }
    if (evidence.completed) break
    await sleep(pollMs)
  }

  let evidence = evidenceOf(await messages(host, sessionID))
  const timedOut = !evidence.completed
  if (timedOut && !aborted) {
    await abortSession(host, sessionID)
    evidence = evidenceOf(await messages(host, sessionID))
  }

  return {
    cue: cue.id,
    repetition,
    sessionID,
    elapsedMs: Date.now() - started,
    timedOut,
    aborted,
    evidence,
  }
}

export async function runProbe(options: ProbeOptions): Promise<ProbeRun[]> {
  const { host, cues, repetitions, timeoutMs, pollMs, onRun } = options
  const runs: ProbeRun[] = []
  for (const cue of cues) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const run = await runCue(host, cue, repetition, timeoutMs, pollMs)
      runs.push(run)
      onRun?.(run)
    }
  }
  return runs
}
