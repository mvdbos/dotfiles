---
name: audit-opencode-session
description: "Forensics on a past OpenCode session's plugin behavior — watchdog advisories, todo-reconcile reminders, goal/watchdog continuations, compaction loops. Use when the user asks to audit a session or asks why a plugin acted or stayed silent."
---

# Audit an OpenCode session

Judge a finished session's plugin behavior against its intended design, with every finding tied to message IDs.

1. **Read intent first.** Load the plugin's source and docs before judging, under `opencode/.config/opencode/`: `watchdog/` (README, state gates, specs), `todo-reconcile/`, goal-plugin templates, and the config that enables them (`opencode.json`, `tui.json`). For watchdog/goal coexistence read `docs/research/opencode-watchdog-plugin-plan.md` and the cache-preserving feedback spec.

2. **Pull the session.** Messages and parts live in `~/.local/share/opencode/opencode.db` (SQLite; the `storage/` JSON tree no longer holds messages). Query by session_id, ordered by time. Child sessions link via `parent_id`; include them. The DB is multi-GB, so filter in SQL rather than scanning whole tables into context.

3. **Classify turns.** Separate human turns from plugin-generated user-role turns: `synthetic=1` parts and metadata keys (`watchdog`, `todo-reconcile`, `compaction_continue`), text-prefix matches against `BUILT_IN_FOREIGN_PATTERNS` in `plugin-generated-user/helpers.ts`, and untagged goal continuations (user-role `promptAsync` turns from the goal plugin). Count each kind.

4. **Evaluate each action.** For every plugin action — advisory, reminder, continuation, snapshot, suppression — decide whether the intended gates allowed it (locks, suppression windows, budgets, timeouts, plan mode), whether it added value, and what it did to the user-visible transcript and prefix cache. Check the silent direction too: where the design says the plugin should have fired, did it?

5. **Report.** Timeline summary, then per-finding verdict with evidence: message/part IDs, verbatim quotes, intended behavior, actual behavior, value, suspected root cause. End with anomalies worth a code change.

The audit is complete when every plugin action in the session is accounted for against its intended design and each finding carries IDs.
