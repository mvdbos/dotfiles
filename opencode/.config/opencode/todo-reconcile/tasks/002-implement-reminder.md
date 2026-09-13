# 002 — Implement reminder formatter

Status: done
Dependencies: 001

## Objective

Create a small pure formatter for persisted todo data and reconciliation guidance.

## Work

- Use the reminder wording in PLAN.md.
- Preserve item order, content, priority, and status strings.
- Serialize task data as JSON rather than interpolating task text into instructions.
- Return no reminder for an empty list.
- Keep `todowrite` guidance conditional on availability.
- Define a documented size bound and explicit omission notice for pathological lists. Ordinary lists must remain complete.
- Keep formatting independent of SDK calls and lifecycle state.

## Acceptance

- Meaningful tests cover mixed statuses, all-completed lists, multiline and instruction-like content, empty lists, and oversized input.
- Wording does not assert completion or order the agent to repeat pending work.
- No status changes or reordering occur during rendering.
- Omitted data is reported visibly; output respects the size bound.

## Verification

Run the implementation project's formatter tests and TypeScript checks. Record exact commands in its README.
