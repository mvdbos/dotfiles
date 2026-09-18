# 04: Protect real-user message targeting

**What to build:** Introduce one shared definition of plugin-generated user messages so watchdog state and todo projection continue to follow the newest genuine human instruction.

**Blocked by:** 03: Prove visible idle and goal arbitration.

**Status:** ready-for-agent

- [ ] Messages classify deterministically as real user, watchdog-generated, or recognized foreign continuation before any turn state changes.
- [ ] Built-in structural patterns match the exact goal-plugin 0.1.49 active and limit fixtures without executing configured regular expressions.
- [ ] Configured patterns support validated `extend` and `replace` modes, deterministic ordered-fragment matching, bounded input, and unique identifiers.
- [ ] A template miss or version drift fails open as a real user turn, with compatibility logging only when drift is detectable.
- [ ] Todo projection selects the newest eligible real user message rather than a watchdog advisory or recognized goal continuation.
- [ ] Ordinary real messages containing todo-reconcile's own synthetic snapshot remain eligible.
- [ ] Unit, composition, compaction, and real-process integration coverage prove the classifier is shared consistently by watchdog and todo projection behavior.
