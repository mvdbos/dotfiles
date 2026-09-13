# 003 — Implement plugin lifecycle

Status: done
Dependencies: 001, 002

## Objective

Deliver the reconciliation reminder to the verified post-compaction continuation.

## Work

- Implement the detector and hook wiring established in task 001.
- Read current persisted todos through the SDK for the correct session when preparing the reminder.
- Attach the reminder at the verified continuation boundary.
- Make repeated transforms idempotent and preserve delivery during retries.
- Isolate concurrent sessions and successive compactions.
- Distinguish failed SDK reads from successful empty responses.
- Fail open on read errors; use bounded retry behavior that does not falsely mark an undelivered reminder as delivered.
- Keep any in-memory state bounded; clean up on session deletion and plugin disposal.
- Recover eligibility from history after restart where the verified contract permits.
- Avoid automatic todo mutations, extra agent turns, direct database reads, and changes to existing user configuration.

## Acceptance

- No reminder before successful compaction or in the summarizer's input.
- First eligible resumed request contains the current persisted snapshot.
- Repeated hook invocation produces no duplicate reminder.
- A retried request retains the reminder.
- A later compaction creates a new reconciliation opportunity even if todo text is identical.
- Session A's todos never appear in session B.
- An SDK failure leaves normal agent execution working.
- Empty lists are skipped; all-completed lists are supported.

## Verification

Run lifecycle tests with realistic fixtures covering event-order variation, repeated transforms, failures, restart, and multiple sessions. Use fake SDK responses; do not require a paid model for these checks.
