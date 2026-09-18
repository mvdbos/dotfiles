# 10: Preserve cadence through foreign continuation

**What to build:** Make goal-plugin continuations extend the current trajectory without resetting watchdog safeguards, starting competing idle loops, or losing tool-count ownership.

**Blocked by:** 07: Deliver guarded idle concerns; 08: Run cadence reviews under a global lease.

**Status:** ready-for-agent

- [ ] A recognized foreign continuation preserves the real-user epoch, original/current task, delivery budgets, pending cadence state, and accepted advisory ownership.
- [ ] Continuation boilerplate is excluded from task and evidence identity, while its tools, failures, todos, assistant output, and changes count normally toward cadence.
- [ ] Foreign arrival cancels pending idle admission and aborts an active idle critic without aborting an independent cadence critic.
- [ ] Completion and cancellation race through one compare-and-set settlement owner, so each idle claim completes or transfers exactly once.
- [ ] Confirmed cancellation moves count, boundary, evidence, and omission markers into one bounded deferred cadence owner without also incrementing unclaimed or pending state.
- [ ] Repeated transfers union only disjoint absolute sequence ownership; `unclaimed + deferred` reaches cadence threshold immediately and the next cadence claim consumes deferred ownership once.
- [ ] While the latest user is foreign, watchdog idle checks and root prompts remain suppressed, but pending cadence findings may wait for the next eligible model boundary.
- [ ] Installed goal-plugin integration proves ordinary idle produces at most one root prompt; the documented no-watchdog-idle-prompt fallback activates if ordinary timing violates that condition.
- [ ] Pattern misses fail open as real user turns and configurable replacement patterns can restore compatibility without a code change.
