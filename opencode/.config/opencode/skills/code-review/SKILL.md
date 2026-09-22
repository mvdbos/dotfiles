---
name: code-review
description: "Review branch changes, working changes, or both against documented Standards and the originating Spec. Use for branch or PR review, work-in-progress review, or review since a selected base."
---

Review the selected task state along two axes:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

The main agent performs Standards and Spec passes sequentially. Review is read-only: do not stage, commit, or edit files to make changes visible.

## Process

### 1. Select and inspect scope

Explicit scope wins. Implementation defaults to working scope and includes branch changes when the task spans commits. For standalone review, ask only if the requested scope is ambiguous.

- **Branch:** committed changes relative to a selected base. Resolve it with `git rev-parse <base>`, find `git merge-base <base> HEAD`, inspect `git diff <base>...HEAD` and `git log <base>..HEAD --oneline`. Ask for a base only when committed changes are included and no base is supplied or established.
- **Working:** inspect `git status --short --untracked-files=all`, `git diff --cached`, and `git diff`. Read relevant untracked files explicitly; Git diff omits their contents. No base is required.
- **Combined:** inspect both inputs, then compare the final working state with the merge-base (`git diff <merge-base>` for tracked files, plus relevant new files). Use commit and staged/unstaged diffs to understand provenance; do not report superseded intermediate changes as final defects.

Use the implementation handoff's task files and pre-existing-edit notes to establish task boundaries, including edits within the same file. Describe known unrelated edits in the scope note, not as findings. Report an interaction with pre-existing work only when task changes cause a concrete defect. Where attribution is uncertain, state the limitation instead of assigning the entire file to this task. Stop and report invalid refs or unavailable evidence. If the selected scope has no changes, report the scope and inputs checked as “no changes in this scope,” not a clean review.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Explicit user-provided source, including a path or requirements in the conversation.
2. Source passed by the implementation workflow.
3. References inferred from commits or branch context, including matching spec files.
4. Ask if still necessary. If the user says no spec exists, skip the Spec pass and report “no spec available.”

Read `docs/agents/issue-tracker.md` only to resolve a tracker-backed source. If that resolution is blocked, ask for the source or report the blocker. An explicit spec or implementation brief needs no tracker setup.

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Perform both passes directly

1. **Standards:** inspect the scoped changes against documented rules and the smell baseline above. Cite the file/hunk and standard for each violation. Label smells as judgment calls, honor repo overrides, and skip rules already enforced by tooling.
2. **Spec:** inspect the same final task state for missing, partial, incorrect, or unrequested behavior. Cite the requirement and relevant code for each finding. Skip this pass only when no spec is available, and report that gap.

For a bounded codebase search that benefits from a separate context, call `task` with `subagent_type: "explore"` once and wait before further work. At most one exploration subagent may be active. Give a specific question, search boundaries, and evidence needed; require findings with file references, relationships, searched locations, and gaps. It reads and reports evidence only: no review judgments, edits, artifacts, skill invocation, or further delegation. The main agent owns judgments and verification.

### 5. Aggregate

Name the scope actually reviewed, task boundaries, attribution uncertainty, and verification limits. Present findings under separate `## Standards` and `## Spec` headings. Do not merge or rerank findings across axes. A clean verdict applies only to the named scope and completed passes.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
