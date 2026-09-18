# 08: Run cadence reviews under a global lease

**What to build:** Add detached every-N-tool trajectory review while keeping the main loop responsive, preserving exact evidence ownership, and limiting critic execution to one process-wide/global slot.

**Blocked by:** 06: Build bounded trajectory evidence.

**Status:** ready-for-agent

- [ ] Each unique significant tool call counts once when it reaches completed or error state; configured exclusions and failure-only event paths match the plan.
- [ ] Reaching the threshold atomically claims an immutable count, sequence boundary, and bounded absolute evidence while later tools remain owned by the next claim.
- [ ] Busy per-root or global critic capacity retains/coalesces the newest covering work instead of dropping it or creating an unbounded queue.
- [ ] Multiple roots receive fair scheduling with idle work ahead of revalidation and cadence work.
- [ ] One independent cross-process lease permits at most one watchdog critic globally without sharing the locks used by existing subagent types.
- [ ] Completed schema-valid reviews advance only their owned count/sequence/change baselines; failed or cancelled attempts preserve eligible evidence for a later claim.
- [ ] Checks remain detached from awaited tool hooks and never block main-agent progress.
- [ ] A cadence check still active after 750 ms shows exactly one informational activity toast; fast, idle, completed, aborted, stale, deleted, and disposed paths leave no late timer.
