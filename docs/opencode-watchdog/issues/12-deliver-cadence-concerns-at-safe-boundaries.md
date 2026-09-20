# 12: Deliver cadence concerns at safe boundaries

**Superseded:** `.scratch/cache-preserving-plugin-feedback/spec.md` replaces request-local
delivery and concern toasts with immutable tool-output trailers and guarded idle follow-ups.

**What to build:** Route accepted cadence findings into the next safe model boundary without mutating stored history or interfering with existing message-transform plugins.

**Blocked by:** 02: Prove prefix-safe request-local feedback; 09: Yield critic capacity to exploration; 10: Preserve cadence through foreign continuation; 11: Suppress noise and revalidate stale concerns.

**Status:** superseded

- [ ] Mid-run request-local delivery is enabled only when ticket 02's ordering, compaction, and prefix-cache probe passed; otherwise cadence concerns follow the tested idle-only path.
- [ ] An eligible concern annotates only the newest completed significant tool result that has not crossed an earlier provider boundary.
- [ ] Later requests in the same turn receive identical advisory bytes at the same tool boundary.
- [ ] Compaction transforms consume a session-specific exclusion and never receive advisory text or semantics.
- [ ] Stored messages remain unchanged and no fake persisted user turn is created for cadence feedback.
- [ ] Accepted concerns influence trajectory through a persisted tool trailer or guarded idle follow-up; no concern toast is emitted.
- [ ] When the latest user is foreign, the concern waits and injects at an eligible goal-driven model boundary rather than creating a watchdog root prompt.
- [ ] Composition tests run watchdog transforms before and after every existing message-transform plugin without deleting, duplicating, or exposing another plugin's markers.
- [ ] If no later provider boundary occurs, the accepted concern remains eligible for the guarded idle route.
