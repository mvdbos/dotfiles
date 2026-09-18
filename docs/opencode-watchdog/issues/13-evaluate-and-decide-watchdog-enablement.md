# 13: Evaluate and decide watchdog enablement

**What to build:** Measure the complete watchdog against a frozen evidence corpus and representative runtime scenarios, then make an explicit evidence-based decision to enable it or keep it disabled.

**Blocked by:** 07: Deliver guarded idle concerns; 09: Yield critic capacity to exploration; 10: Preserve cadence through foreign continuation; 11: Suppress noise and revalidate stale concerns; 12: Deliver cadence concerns at safe boundaries.

**Status:** ready-for-agent

- [ ] A frozen corpus contains at least 20 positive and 40 negative bounded packet fixtures covering every planned concern class, valid unusual work, stale findings, prompt injection, and malformed output.
- [ ] Evaluation reports true-positive rate, false-positive rate, category precision, duplicate-warning rate, interruption frequency, latency, token/character use, malformed output, and packet-size distributions.
- [ ] Runtime evaluation reports activity/concern toast behavior, skipped unchanged evidence, prefix-cache impact, critic cache behavior, foreign pattern matches, dual-prompt races, goal deferral, and goal token accounting.
- [ ] Results compare no-watchdog, idle-only, and cadence modes using the same frozen cases.
- [ ] The final user prompt never exceeds 16,384 UTF-8 bytes; packet p95, output length, latency, false-positive, true-positive, duplication, interruption, cache, and fail-open targets are checked against the plan.
- [ ] The co-resident goal fixture produces at most one ordinary-timing root prompt or activates the no-watchdog-idle-prompt fallback before enablement.
- [ ] All watchdog, composition, real-OpenCode integration, and existing plugin regression suites pass.
- [ ] A stochastic live-model test remains opt-in and cannot make CI flaky.
- [ ] Configuration remains disabled by default unless every shipping criterion passes; the enable-or-remain-disabled decision and any disabled capabilities are recorded with measured reasons.
