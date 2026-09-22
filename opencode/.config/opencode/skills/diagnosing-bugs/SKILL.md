---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.
---

# Diagnosing Bugs

Investigate the reported symptom, identify an evidence-backed cause where possible, and verify a fix against that symptom. Explain skipped phases or blockers.

When exploring the codebase, read `CONTEXT.md` (if it exists) to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1: Build a feedback loop

Build a **tight** feedback loop: a fast, discriminating signal for the reported symptom. Use tentative hypotheses to locate, construct, or minimize a repro; treat them as investigation leads, not established causes. Require evidence before declaring a cause.

Prioritize a useful signal. If progress stalls, summarize attempts and the specific missing evidence or access.

### Ways to construct one, in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) that drives the UI and asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", generate inputs targeting the failure mode. Choose runs based on observed signal and investigation cost; record attempts, seeds, and uncertainty.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **HITL bash script.** If a human must interact, read `scripts/hitl-loop.template.sh` in this skill directory and prepare a task-specific copy. Have the user run it in their terminal and return redacted captured output. The OpenCode `bash` tool cannot accept their interactive answers.

Use the loop to distinguish plausible causes and later verify the fix.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A faster, more repeatable loop makes comparisons easier; retain a slower or intermittent loop when it supplies useful evidence.

### Non-deterministic bugs

Record the observed reproduction rate, actual attempts, and uncertainty. Repeat triggers, use parallel stress tests when appropriate, or vary timing to improve the signal. Choose runs based on observed signal and cost, not a fixed count. Low-frequency bugs can still yield useful traces; absence of failure in a small sample does not establish a fix.

### When you genuinely cannot build a loop

Report what you tried and the specific gap. Ask for the environment access, redacted artifact, or instrumentation permission needed next. Tentative hypotheses may guide that request, but do not claim an established cause or verified fix without evidence.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: name a command (a script path, a test invocation, a curl) already run by you or the user, show its redacted output, and confirm that it is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring"; it must be able to _catch this specific bug_.
- [ ] **Repeatable enough to compare**: deterministic where possible; otherwise report the observed reproduction rate and uncertainty.
- [ ] **Practical**: fast enough for useful comparisons given investigation cost.
- [ ] **Runnable by the appropriate actor**: run unattended when possible; otherwise use the user-run `scripts/hitl-loop.template.sh` flow.

Code reading and tentative hypotheses may help construct this command. If no useful signal can be obtained, report the blocker rather than treating a plausible theory as proof.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The observed failures provide useful evidence for comparing causes. For intermittent bugs, report attempts, reproduction rate, and uncertainty.
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro until it supports useful discrimination between plausible causes. Cut inputs, callers, config, data, and steps **one at a time**, rerunning after each cut and retaining the reported failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Proceed when the repro is small enough to test plausible causes meaningfully. Further minimization is optional when its cost exceeds its diagnostic value. If progress stalls, summarize attempts and missing evidence.

## Phase 3: Hypothesise

Rank plausible hypotheses supported by current evidence, including alternatives to the leading explanation, before testing them.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it; proceed with your ranking if the user is AFK.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5: Fix + regression test

Write the regression test **before the fix**, but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.

If no correct seam exists, apply an evidence-backed fix and verify with the original feedback loop; report the regression-coverage gap. If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

## Phase 6: Cleanup

Required before declaring done:

- [ ] Re-run the Phase 1 loop against the original symptom and report the result; for intermittent bugs, report actual attempts and remaining uncertainty instead of treating no observed failures as proof
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] State the supported cause, verification evidence, and remaining uncertainty in the final summary; include them in a commit / PR message only when that action is explicitly authorized
