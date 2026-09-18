# 05: Run one silent isolated idle review

**What to build:** Deliver the smallest production watchdog path: one unique root idle boundary launches one isolated review, validates the result, records the outcome, and never interferes with the main agent.

**Blocked by:** 01: Prove isolated critic execution; 03: Prove visible idle and goal arbitration; 04: Protect real-user message targeting.

**Status:** ready-for-agent

- [ ] Missing, disabled, or invalid configuration disables watchdog review with one clear bounded reason and no model fallback.
- [ ] Only root sessions with a genuine user task are eligible; critic, child, internal, and generated-user sessions cannot recursively trigger reviews.
- [ ] Repeated idle events for the same completed assistant snapshot create at most one review.
- [ ] Idle admission waits the configured settle period, rechecks current generation/epoch/latest-user/idle state, and stops when any changed.
- [ ] Every attempt uses a fresh isolated critic child and the provider contract proven in ticket 01.
- [ ] Critic text is accepted only as strict `ok` or one schema-valid bounded concern; malformed, oversized, timed-out, or provider-error results fail open.
- [ ] This slice emits no advisory, root prompt, or concern toast; results are observable only through bounded structured test/debug records.
- [ ] Deletion, disposal, timeout, and cancellation leave no active child or unhandled detached promise.
