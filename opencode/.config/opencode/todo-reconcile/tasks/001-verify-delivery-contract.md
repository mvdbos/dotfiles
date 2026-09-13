# 001 — Verify delivery contract

Status: done
Dependencies: none

## Objective

Establish a reliable post-compaction injection point before implementing lifecycle logic.

## Work

- Inspect version-pinned prompt loop, message conversion, compaction filtering, plugin dispatch, and SDK todo API.
- Record the exact SDK method signature and response/error shape for reading session todos.
- Trace manual compaction, automatic continuation, and overflow/user-message replay.
- Determine how successful compaction and the first ordinary continuation appear in message-transform input.
- Determine how to exclude summarizer, title, and other internal requests.
- Verify whether synthetic text added during transform reaches the resumed agent without modifying persisted message history.
- Identify stable session, compaction, and continuation keys.
- Check event dispatch ordering, request retries, repeated transforms, plugin restart, and session deletion.
- Resolve how an ephemeral reminder stays available on a retried request without duplicate insertion or indefinite repeated nudging.

## Deliverable

Write a delivery-contract note alongside the implementation. Include source references, hook sequence, representative message fixtures, chosen algorithm, and limitations. Update PLAN.md if the proposed architecture needs adjustment.

## Acceptance

- The injection point covers manual, automatic, and overflow compaction.
- Failed compaction does not qualify.
- Summarization cannot consume the reminder intended for continuation.
- Duplicate transforms preserve delivery without duplicate reminders.
- Restart behavior is explicit and supported by evidence.
- If public hooks cannot support the contract reliably, document the blocker and propose the smallest viable revision before task 003.
