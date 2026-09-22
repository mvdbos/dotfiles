# Scoped grilling interview

Use this reference when a caller requests an interview about a plan, decision, or idea. Produce a confirmed summary of the scoped decision; the caller owns any artifacts or implementation.

1. Establish the requested decision and scope from the conversation. Ask if either is missing. Maintain settled decisions, open blockers, and deferred questions in conversation context.
2. Map relevant decisions as a **design tree**: each decision can unblock dependent decisions. Ask only questions whose answers could change the scoped decision.
3. Gather facts before dependent questions. Use direct tools for small lookups. If a bounded codebase search benefits from a separate context, call `task` with `subagent_type: "explore"` once. Supply a specific question, search boundaries, and evidence needed. Require file references, relationships, searched locations, and gaps; evidence only, with no edits, artifacts, judgments, skill invocation, or further delegation. Wait before any further work or interview questions. At most one exploration subagent may be active. The main agent owns decisions, writing, and verification. If evidence is inaccessible, state the gap and ask for needed access or information.
4. Work in **rounds**. The **frontier** contains relevant decisions whose prerequisites are settled. Ask the independent frontier questions together, numbering each and recommending an answer with reasons. Wait for the user's answers before the next round. A question depending on an unanswered question belongs to a later round.
5. Update settled decisions, blockers, and deferred questions after each round. Finish when the scoped decision is settled and blockers are resolved or explicitly deferred with their consequences. Summarize these outcomes and ask the user to confirm shared understanding before acting on them. If progress is blocked, explain the specific missing decision or evidence.

## Round format

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```
