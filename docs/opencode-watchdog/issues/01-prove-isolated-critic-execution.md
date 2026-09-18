# 01: Prove isolated critic execution

**What to build:** Establish an executable OpenCode feasibility probe for one observation-only watchdog critic. The probe must determine the exact supported runtime contract before production watchdog behavior depends on it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A real OpenCode fixture creates a fresh parent-linked critic child and captures its final provider request.
- [ ] The captured request uses the explicitly configured critic model, disables thinking, exposes no callable tools or structured-output helper, and limits output to 256 tokens.
- [ ] The critic cannot inherit a root session's agent, model, variant, tools, or permissions in a way that weakens isolation.
- [ ] Normal completion deletes the child; timeout and cancellation abort the server-side runner before deletion and lease release.
- [ ] The fixture proves whether `hidden` and one-step agent settings work on the supported OpenCode version and records explicit fallbacks when they do not.
- [ ] Slow-provider coverage proves a cancelled request cannot overlap a replacement critic request.
- [ ] Probe results remain as automated regression evidence; temporary probe-only plugin wiring is removed.
