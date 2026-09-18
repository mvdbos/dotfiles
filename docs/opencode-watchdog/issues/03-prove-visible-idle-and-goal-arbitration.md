# 03: Prove visible idle and goal arbitration

**What to build:** Establish the supported idle-feedback path and its coexistence limits with the installed goal plugin, using a real OpenCode process and attached TUI.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A detached synchronous idle prompt reliably wakes one root response and preserves the verified root agent/model selection; variant preservation or omission follows an explicitly tested path.
- [ ] Marker-tagged text with `synthetic` omitted or false appears in the TUI, while equivalent synthetic text does not.
- [ ] Informational, warning, and error toasts render without creating transcript messages or blocking hooks.
- [ ] Fixtures capture the exact active and limit continuation structures emitted by goal-plugin 0.1.49 on both supported idle event forms.
- [ ] Under ordinary timing, an active goal idle queues at most the goal continuation and cancels watchdog idle admission before critic creation or watchdog root prompting.
- [ ] A deliberately late goal continuation demonstrates the residual race; ordinary-timing failure records the mandatory fallback that disables watchdog root-idle prompting while the goal plugin is configured.
- [ ] Critic child creation temporarily defers goal continuation and normal child cleanup releases it; the external plugin's bounded worst-case deferral is documented by the fixture.
- [ ] Root advisory usage counts toward goal token accounting, critic-child usage does not, and goal continuations remain root turns.
