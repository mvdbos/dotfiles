# 07: Deliver guarded idle concerns

**What to build:** Turn an accepted concern at an eligible real-user idle boundary into one visible, provenance-marked request for reconsideration without creating a recursive watchdog loop.

**Blocked by:** 04: Protect real-user message targeting; 06: Build bounded trajectory evidence.

**Status:** ready-for-agent

- [ ] Before side effects, idle delivery atomically rechecks the real-turn epoch, latest-user classification, idle generation, advisory ownership, and delivery budget.
- [ ] An accepted warning or critical concern creates one bounded severity toast and one visible marker-tagged, non-synthetic transcript follow-up.
- [ ] The follow-up is explicitly presented as secondary-model advice rather than a user instruction.
- [ ] One warning may be followed only by one independent critical on changed evidence; a critical-first delivery prevents every later delivery in that real turn.
- [ ] A continuation claim marks watchdog-generated feedback before submission and its resulting idle consumes the claim without another review.
- [ ] Pending or delivered toast state suppresses duplicates; one idle retry is allowed only after a known toast failure.
- [ ] Prompt failure clears the unused continuation claim, retains the consumed delivery budget, logs bounded diagnostics, and does not retry that turn.
- [ ] A recognized foreign latest user suppresses the root follow-up and preserves the concern for a later eligible boundary.
