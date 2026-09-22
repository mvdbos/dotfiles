---
description: Start a fresh autonomous implementation goal from approved spec or ticket paths.
agent: build
---

This command is explicit user authorization to create and execute one new goal and to commit each completed unit.
Its arguments must identify approved specs or tickets through ordinary repository paths or ticket IDs; pass paths directly rather than through `@` attachments.

1. Call `get_goal` before doing goal work. This command requires a fresh session. If any goal state exists, leave it unchanged, stop, and tell the user to run `/afk` in a fresh session.
2. If the `Approved scope` section below is empty or only whitespace, stop without calling `create_goal` and tell the user to provide approved spec or ticket paths.
3. If no goal exists and the scope is present, call `create_goal` exactly once with exactly the text inside `<afk_goal>` as its objective:

<afk_goal>
Implement the approved scope fully.

AFK execution policy:
- The user is unavailable. Make every decision yourself; ask no questions and do not call the `question` tool.
- Treat the approved spec and tickets as authoritative input, not as a place to record decisions.
- Always produce a viable solution. When an approach fails or ambiguity appears, choose another reasonable solution and continue.
- Follow the project's explicitly documented mechanisms for decision records, ticket state, verification, and cleanup. Do not invent substitute mechanisms.
- Respect ticket dependency edges.
- Verify and commit each completed unit before starting the next.
- Continue until the entire scope is implemented and verified. Audit real artifacts and command output before closing the goal. Close it as complete only with evidence; mark it unmet only when an immutable external constraint makes every viable solution impossible.

Approved scope:
$ARGUMENTS
</afk_goal>

4. After `create_goal` succeeds, begin implementation in this turn. Do not stop after announcing that the goal is active. The goal plugin owns persistence, idle continuation, compaction recovery, limits, and evidence-based closure.
