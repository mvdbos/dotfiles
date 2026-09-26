---
name: audit-opencode-session
description: "Forensics on a past OpenCode session's plugin behavior — todo snapshots, goal continuations, and compaction loops. Use when the user asks to audit a session or why a plugin acted or stayed silent."
---

# Audit an OpenCode session

Judge a finished session's plugin behavior against its intended design, with every finding tied to message IDs.

1. **Read intent first.** Load the relevant plugin's source and docs under `opencode/.config/opencode/`; for todo snapshots read `todo-reconcile/` and its integration tests. Check the config that enables the plugin and the installed goal-plugin version when continuations are involved.

2. **Pull the session.** Messages and parts live in `~/.local/share/opencode/opencode.db` (SQLite; the `storage/` JSON tree no longer holds messages). Query by session_id, ordered by time. Child sessions link via `parent_id`; include them. The DB is multi-GB, so filter in SQL rather than scanning whole tables into context.

3. **Classify turns.** Separate human turns from compaction continuations and goal-plugin `promptAsync` user-role turns. Identify synthetic todo snapshot parts by `metadata["todo-reconcile"]`. Count each kind.

4. **Evaluate each action.** For each snapshot or continuation, check eligibility, target, timing, value, effect on the transcript and prefix cache. Check where a snapshot should have been installed but was not.

5. **Report.** Timeline summary, then per-finding verdict with evidence: message/part IDs, verbatim quotes, intended behavior, actual behavior, value, suspected root cause. End with anomalies worth a code change.

The audit is complete when every plugin action in the session is accounted for against its intended design and each finding carries IDs.
