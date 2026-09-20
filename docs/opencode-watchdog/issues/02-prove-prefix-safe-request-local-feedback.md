# 02: Prove prefix-safe request-local feedback

**Superseded:** `.scratch/cache-preserving-plugin-feedback/spec.md` replaces request-local
delivery with immutable persisted tool-output trailers. This file records the earlier probe.

**What to build:** Establish whether an accepted watchdog concern can be added to the next main-model request without changing stored history, contaminating compaction, or invalidating the historical provider prefix.

**Blocked by:** None (can start immediately).

**Status:** superseded

- [ ] A real OpenCode fixture appends a bounded advisory to the newest fresh completed tool result in the request-local message copy.
- [ ] The advisory reaches the next main-model request and repeats byte-identically at the same boundary on later requests in that turn.
- [ ] Stored session messages never contain the request-local advisory.
- [ ] A session-specific compaction exclusion prevents the advisory text and its semantics from entering a persisted summary, including with concurrent root sessions.
- [ ] Provider-request evidence shows no historical prompt bytes change before the feedback-bearing tool result and verifies expected cache-read behavior.
- [ ] The probe records one deterministic product decision: enable request-local mid-run delivery when every ordering assertion passes, otherwise disable it and route concerns through idle only.
- [ ] Probe results remain as automated regression evidence; temporary probe-only plugin wiring is removed.
