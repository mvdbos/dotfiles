---
name: research
description: Investigate a bounded question against primary sources and save cited findings as Markdown in the repo. Use when the user wants a topic researched or docs and API facts gathered.
---

The main agent researches and writes the artifact directly. No tracker setup is required.

1. Identify the scoped question from the request. Ask only if missing scope prevents useful research.
2. Investigate using **primary sources**: official docs, source code, specs, and first-party APIs. Use direct tools for small lookups. Cite sources for factual claims; distinguish evidence from inference and note unavailable evidence rather than inventing an answer. Issue comments are reports, not authoritative documentation. If sources disagree, identify their versions and evidence rather than silently choosing one. Once the scoped question is answered, proceed to writing instead of expanding the investigation.
3. If a bounded codebase search benefits from a separate context, call `task` with `subagent_type: "explore"` once. Supply the specific question, paths/search boundaries, and evidence needed. Require findings with file references, relationships, searched locations, and gaps. The assignment is read-only: no edits, artifacts, judgments, web research, skill invocation, or further delegation. Wait for its result before further work; at most one exploration subagent may be active. The main agent owns analysis, writing, and verification.
4. Write one Markdown findings file where the repo keeps research notes. If no convention exists, use `docs/research/<topic>.md`. Answer the scoped question, cite the evidence, and state unresolved gaps. Commit only with explicit user authorization.
5. Read the saved file. Check its factual claims against the cited passages and tool results. Remove unsupported claims and contradictions, including gaps already answered by the evidence. Report installed behavior only to the extent actually observed.
6. Return a Markdown link to the findings file, summarize the answer or blocker, and stop.
