---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the user's spec or tickets and report the changes, verification, and remaining blockers.

1. Read the originating task. Before editing, inspect repository status and existing staged and unstaged changes in files you will touch; read relevant untracked files. Keep a brief note of pre-existing work and attribution uncertainty in the conversation.
2. Implement directly. For every behavior change with a testable public interface, load the `tdd` skill before editing production code and follow its red-green loop; documentation-only and otherwise untestable changes are exempt. Treat seams named by the task or repository documentation as pre-agreed. Resolve missing seam agreement under an explicit decision policy supplied by the invoking workflow; otherwise ask the user. Do not invent the requirement.
3. Run relevant typechecking and focused tests during implementation, then the applicable full suite at the end. Report unavailable or failing checks accurately.
4. Load `code-review` before committing. Pass the originating task/spec, intended scope, task-changed files, known pre-existing edits and attribution uncertainty, and verification performed. Default to working scope; include branch scope and its base when the task spans commits. An explicit user scope wins.
5. Address review findings and verify affected behavior. Commit only if the user explicitly authorized it, staging only intended files. Otherwise report the current uncommitted state.
