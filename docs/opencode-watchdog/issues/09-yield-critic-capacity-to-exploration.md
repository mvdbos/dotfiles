# 09: Yield critic capacity to exploration

**What to build:** Ensure local exploration always takes precedence over watchdog inference while preserving watchdog work for safe later resumption.

**Blocked by:** 08: Run cadence reviews under a global lease.

**Status:** ready-for-agent

- [ ] Explore admission and direct explore-session lifecycle are recognized before or while watchdog critic work runs.
- [ ] Pending exploration never waits to acquire a watchdog-owned lock or lease.
- [ ] Local exploration aborts an active critic server-side, deletes the child, and only then releases the watchdog lease when termination is confirmed.
- [ ] Uncertain critic termination keeps the watchdog lease until terminal evidence or stale-owner recovery proves replacement cannot overlap it.
- [ ] Preempted watchdog evidence remains pending, coalesces with newer covering evidence, and resumes after local exploration ends.
- [ ] Activity-toast timers are cancelled during preemption and cannot fire late.
- [ ] Cross-process exploration contention remains an explicitly measured MVP risk rather than introducing a shared lock that could delay exploration.
- [ ] Existing explore and general concurrency behavior and tests remain unchanged.
