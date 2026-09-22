---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

Resolve the requested merge/rebase conflicts, preserving compatible change intents, and report resolved files, checks, and any blocker.

1. **Record the initial state** in conversation context: `git status`, staged and unstaged changes, unmerged paths, and merge/rebase history. Distinguish conflicts from unrelated user work before editing.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where compatible. If incompatible, use the requested outcome only when it resolves the choice and explain the trade-off. Otherwise ask the user and report the unresolved conflict as a blocker. Do not invent behavior or abort the operation without authorization.

4. Discover the project's **automated checks** and run them, typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Stage only files intentionally resolved for this task**, preserving unrelated edits and existing staged work. If unrelated edits share a file and cannot be separated safely, report the blocker instead of staging them. Finish the merge or continue the rebase only with applicable explicit user authorization; the skill does not authorize commits. Otherwise leave the resolved state ready for continuation and report it accurately. Completion may be a verified resolution or a clearly explained blocker.
