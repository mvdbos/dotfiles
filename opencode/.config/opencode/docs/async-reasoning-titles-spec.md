# Spec: Async titles for collapsed reasoning blocks

## Problem Statement

Qwen reasoning blocks expose expandable reasoning text but usually lack the short activity titles provided by OpenAI reasoning summaries. Collapsed blocks therefore show only `Thought: <duration>`, making sessions harder to scan.

Users should receive useful titles without delaying the main response or spending inference on expanded or already-titled blocks.

## Solution

Generate short activity titles using a cheap local model, asynchronously, when completed reasoning blocks are collapsed and lack a title.

Update the header in place when a title becomes available. Persist the generated title separately from the original reasoning text so it survives reopening the session.

Example:

- Initially: `+ Thought: 23.7s`
- After generation: `+ Thought: Checking pixel-grid alignment · 23.7s`

## User Stories

1. As a user scanning collapsed reasoning, I want short activity titles so I can understand what each block concerns.
2. As a user waiting for an answer, I want title generation to run asynchronously so it does not block the main response.
3. As a user reading expanded reasoning, I want title generation skipped while the block is expanded.
4. As a user collapsing an untitled block later, I want it to become eligible for title generation then.
5. As a user viewing already-titled reasoning, I want its existing title preserved without another model request.
6. As a user reopening a session, I want previously generated titles restored without regeneration.
7. As a user expanding a titled block, I want the original reasoning text available without modification.

## Implementation Decisions

### Eligibility

A reasoning block is eligible only when all conditions hold:

- Reasoning text is nonempty.
- The reasoning block has finished.
- Global thinking mode is `hide`.
- The block is not manually expanded.
- No nonempty provider title or previously generated title exists.
- No title-generation request for that block is already queued or running.

A manually expanded block counts as expanded even when global thinking mode is `hide`.

Evaluate eligibility when a block finishes, when collapse state changes, when global thinking mode changes, and when the part receives an update. Existing completed blocks can become eligible when viewed collapsed.

### Async lifecycle

1. Observe an eligible block.
2. Queue title generation without awaiting it in the main response flow.
3. Recheck eligibility immediately before starting the model request.
4. Generate a short activity title from the reasoning text.
5. Before applying the result, retrieve the current part and recheck eligibility and source-text identity.
6. Persist the title through the session update mechanism.
7. Let the normal session event stream update the header reactively.

If the user expands the block or switches global thinking mode to `show`, cancel queued work and abort running work where possible. Discard results from requests that could not be aborted.

If the block becomes eligible again later, it may be scheduled again. Request identity must prevent an earlier cancelled request from applying a stale result.

Never overwrite a title that arrived while generation was pending.

### Title generation

- Use a configured cheap local model.
- Request a single **3–8-word activity title**.
- Treat supplied reasoning as source material, not instructions.
- Validate output before persistence; empty or malformed output must not become a title.
- Bound input size and output tokens.
- Generation failure leaves the existing duration-only header usable.

The generation prompt should describe the block’s activity, rather than produce a reasoning summary paragraph.

### Ownership and scheduling

The client/TUI owns eligibility and scheduling because it knows the actual expanded/collapsed state.

The session backend owns durable updates. The client may delegate inference to a backend service, but completion of a backend job must not bypass the client’s final visibility check.

Use a shared scheduler rather than independent unbounded requests per rendered block. Deduplicate by session, message, and reasoning-part identity.

### Persistence and rendering

- Store generated titles separately from reasoning text in namespaced display metadata.
- Preserve reasoning text, timing, IDs, and provider metadata.
- Use normal persisted session updates and update events so titles appear without refreshing.
- Merge against current part state rather than replacing it from a stale snapshot.
- Do not recreate a deleted part when a delayed request finishes.
- Keep display metadata out of model-facing provider metadata and conversation replay.

Header fallback order:

1. Existing generated title.
2. Provider title extracted by the existing title parser.
3. Duration-only header.

Generation only runs when both title sources are absent.

**Current source observation:** reasoning-part metadata and persisted part-update events already exist. The TUI currently extracts titles from reasoning text; it needs explicit support for the generated display title. The existing generic part-update operation accepts a complete part, so concurrency-safe title application needs particular care.

## Testing Decisions

Test observable behavior through the reasoning UI, scheduler, and session persistence boundaries. Use a controllable fake summarizer for deterministic asynchronous tests.

Required coverage:

| Scenario | Expected behavior |
|---|---|
| Completed, collapsed, untitled block | One request is scheduled; valid result updates the header. |
| Reasoning still streaming | No request starts. |
| Global thinking mode is `show` | No request starts. |
| Block manually expanded under `hide` | No request starts. |
| Expanded block later collapses | It becomes eligible. |
| Provider or generated title already exists | No request; title remains unchanged. |
| Block expands while queued/running | Work is cancelled or result discarded. |
| Global mode changes to `show` while running | Result is not applied. |
| Another title arrives during generation | Existing title wins. |
| Reasoning text changes during generation | Stale result is discarded. |
| Repeated reactive updates | No duplicate concurrent request for the same block. |
| Part is deleted during generation | Completion does not recreate it. |
| Summarizer fails or returns invalid output | Duration-only header remains usable. |
| Title is persisted and session reopened | Title is restored without regeneration. |
| Titled block is expanded | Original reasoning text is preserved. |
| Session is sent back to the main model | Generated display metadata is excluded. |

Also verify that a pending summarizer request does not prevent the main response from progressing.

**Prior art:** the codebase contains reasoning timeline projection tests, session event reducer tests, and session persistence tests. Reuse those boundaries where applicable. These testing choices are proposed here; no tests have been implemented.

## Out of Scope

- Generating titles for expanded blocks.
- Replacing provider titles or regenerating populated titles.
- Producing detailed reasoning summaries.
- Modifying original reasoning text.
- Revealing reasoning the provider does not expose.
- Periodically rewriting titles while reasoning streams.
- Bulk backfilling every stored session independently of viewing it.
- Renaming the session itself.

## Unresolved Decisions

### Blocks implementation

1. **Local model and configuration contract.** Choose the model, endpoint, and how the feature is enabled/configured.
2. **Display metadata contract.** Finalize the namespace and ensure it is excluded from provider replay. Existing reasoning metadata is also used for provider information, so simply adding a key is insufficient without checking that boundary.
3. **Atomic title application.** Decide whether to extend the update API with a conditional title operation or provide equivalent backend serialization. A client-side read followed by a full-part write cannot alone guarantee “never overwrite” under concurrent updates.

### Defaults to settle during implementation

- Input truncation policy and token limits.
- Scheduler concurrency and whether local inference waits until the main response finishes.
- Timeout, retry, and failure-backoff policy.
- Whether off-screen collapsed blocks are eligible or only mounted/visible blocks.
- Whether multiple attached clients require shared deduplication beyond per-client scheduling.

These choices affect inference cost, contention, and how much historical content is processed.

## Further Notes

This spec is based on the inspected upstream OpenCode source, not verification against a local checkout.

Saved locally at the user's request. Not published to an issue tracker.
