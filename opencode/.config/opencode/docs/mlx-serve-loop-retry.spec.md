# mlx-serve repetition-loop retry plugin — spec

Status: approved (design confirmed 2026-09-13). Implementation not started.
Target: opencode 1.18.30 (commit `3104c1428ec91f809e5ab86631300de41eb6952e`). Re-verify the
plugin hooks and SDK methods on any opencode upgrade before trusting this document.

## 1. Purpose

mlx-serve cuts a generation that collapses into a repetition loop and reports the cause as
`finish_details: { "type": "repetition_loop" }` beside `finish_reason: "length"`. opencode's
AI SDK provider adapter (`session/llm/ai-sdk.ts`) maps only `finishReason`, so the session
records `length` and the looped reply stays in history. An agent that re-sends that history
feeds the loop back to the model.

This plugin detects the cause on the wire, removes the looped turn, and re-runs the same user
turn up to a configurable number of attempts.

Non-goals (explicitly deferred): backoff, cancellation, compaction interplay, retry state
across restarts, child-session retries, retries for any other finish cause.

## 2. Verified platform facts

- mlx-serve sends the field on the final streaming chunk (verified live on 1.18.30).
- `finish_details` never reaches `LLMEvent.stepFinish`; ordinary plugin events
  (`message.updated`, `message.part.updated`) carry only `length`.
- A plugin can replace the provider's `fetch` in its `config` hook; provider resolution chains
  that function (`provider/provider.ts`, `resolveSDK`, `customFetch`).
- For non-opencode providers the request carries `x-session-affinity` and `X-Session-Id`
  (`session/llm/request.ts`). The plugin stamps the user message id itself in `chat.headers`.
- Regenerate primitive: `session.revert({ messageID: <assistantID> })` stages a rewind to the
  last user message; `session.prompt({ messageID: <userID>, parts, agent, model })` calls
  `revert.cleanup()` (deletes the looped reply) and re-runs the same user message
  (`session/revert.ts`, `session/prompt.ts`).
- `session.idle` event: `{ sessionID }` (`schema/src/session-status-event.ts`).
- `client.tui.showToast({ body: { title?, message, variant, duration? } })` exists; without a
  TUI subscriber it is a no-op, so `opencode run` needs no special casing.

## 3. Configuration

```json
"plugin": [
  ["./plugins/mlx-serve-loop-retry.ts", { "retries": 3, "provider": "mlx-serve" }]
]
```

- File: `~/.config/opencode/plugins/mlx-serve-loop-retry.ts` (auto-discovered).
- `retries`: integer >= 0, default 3. `0` disables: the fetch wrapper is not installed and the
  plugin is a no-op.
- `provider`: provider config id, default `"mlx-serve"`; overridable for renamed providers.
- Invalid or missing options fall back to defaults and log once.

## 4. Runtime design

### 4.1 Hooks

| Hook | Purpose |
|---|---|
| `config` | locate the provider, wrap its `options.fetch` |
| `chat.headers` | stamp `x-mlx-serve-loop-request` with the user message id |
| `event` | act on `session.idle` |

### 4.2 Fetch wrapper

- Installed only when `retries > 0` and the configured provider exists with an options object.
- Capture `const upstream = options.fetch ?? fetch` once; mark the wrapper with a
  `__mlxServeLoopRetry` property and skip if already marked (provider resolution replaces
  `options.fetch` again, so a repeat `config` call must not double-wrap).
- Inspect only `Content-Type: text/event-stream` responses; anything else passes through.
- `response.clone()` and read the clone; the original stream is returned untouched.
- Buffer SSE lines across reads; parse lines starting `data: `; skip `[DONE]`; `JSON.parse`
  each payload; a chunk hit is `choices[].finish_details.type === "repetition_loop"`.
- On hit: `pending.add(key)`, log `loop-detected`.
- All inspector errors are caught and never affect the response.
- Correlation: `sessionID` from `x-session-affinity` or `X-Session-Id`; `userMessageID` from
  `x-mlx-serve-loop-request`. If either is missing, log once and skip detection.

### 4.3 chat.headers

For requests to the configured provider, set
`output.headers["x-mlx-serve-loop-request"] = input.message.id`.

### 4.4 State (in memory only)

```
key = `${sessionID}:${userMessageID}`
pending:  Set<key>            // loop detected, awaiting idle
attempts: Map<key, number>    // retries already fired for this turn
```

### 4.5 Idle handler

On `session.idle({ sessionID })`:

1. Delete `attempts` entries for this session that are not pending (turn ended without a loop;
   a new user message always creates a new key).
2. If no pending key exists for this session, return.
3. `client.session.get({ path: { id: sessionID } })`; if `parentID` is set, log
   `child-session-skipped`, clear pending, return.
4. `n = attempts.get(key) ?? 0`.
   - `n >= retries` → exhaustion: error toast, log `exhausted`, clear pending and attempts.
   - else fire retry `n + 1`.

Retry execution:

- `client.session.messages({ path: { id: sessionID } })`; find user message `userMessageID` and
  the last assistant message whose `parentID` equals it. Missing either → log
  `retry-dropped`, clear state.
- `parts = toPromptParts(userMessage.parts)`: keep `text`, `file`, `agent`, `subtask` parts,
  skip `synthetic`, drop unknown types; empty result → `retry-dropped`, clear state.
- `client.session.revert({ path: { id: sessionID }, body: { messageID: assistantMessageID } })`.
- `client.session.promptAsync({ path: { id: sessionID }, body: { messageID: userMessageID,
  parts, agent: userMessage.agent, model: userMessage.model } })`.
- Warn toast before firing, `Repeated output loop — retrying {n+1}/{retries}`.
- On success of both calls: `attempts.set(key, n + 1)`, clear pending.
- On any error or returned `error` (including `BusyError` when a user prompt raced ahead):
  log `retry-failed`, clear pending and attempts. No re-queue, no timer, no backoff.

Ordering assumption: the clone reader observes the final SSE chunk before `session.idle`
(both consume the same tee; idle follows message persistence and several async steps). If the
flag is set late, that turn is simply not retried.

### 4.6 Notices

- Attempt: `variant: "warning"`, title `mlx-serve`,
  message `Repeated output loop — retrying {n}/{retries}`.
- Exhaustion: `variant: "error"`, title `mlx-serve`,
  message `Repeated output loop — gave up after {retries} retries`.
- Toast failures are swallowed. `opencode run` renders nothing (no TUI subscriber); every
  event is also logged.

### 4.7 Logging

One `console.error` line per event, prefix `[mlx-serve-loop-retry]`, compact JSON payload:
`{ event, sessionID, userMessageID, attempt?, retries? }`.
Events: `disabled`, `provider-missing`, `loop-detected`, `child-session-skipped`,
`retry-started`, `retry-failed`, `retry-dropped`, `exhausted`.

## 5. Accepted consequences

- One retry removes the looped assistant message, rolls back that turn's file edits, and
  re-runs the turn's tool calls.
- The transcript keeps exactly one user message for the turn (same id).
- After exhaustion the final looped reply stays in the transcript, as today.
- A user prompt that races the retry wins; the retry is dropped.

## 6. Pure helpers (exported for tests)

- `toPromptParts(parts)` → mapped parts array (or empty).
- `parseSseLoopChunk(lineBuffer)` → `{ hit: boolean, rest: string }`-style incremental parser.
- `decideIdle({ pending, attempts, retries, parentID })` → `skip-child | give-up | retry | none`.
- `toastFor(kind, attempt, retries)` → `{ title, message, variant }`.

## 7. Test plan

A. Hermetic helper tests (`node --test --experimental-strip-types` or `bun test`):
   decision table for `decideIdle`; parts mapping with a synthetic part filtered and an image
   file part preserved; toast text; SSE parser across split chunks and CRLF.

B. Fixture integration (node HTTP fixture emitting openai-compatible SSE; isolated
   `HOME`/`XDG_*`/`OPENCODE_CONFIG`; `opencode run --format json` with the plugin pointed at
   the fixture):
   1. loop then healthy: exactly one retry; one user message with the original id; final
      assistant normal; logs `loop-detected` + `retry-started 1/3`.
   2. loop always: 3 retries then `exhausted`; exactly 4 generation requests for the turn.
   3. `retries: 0`: one request, no plugin logs.
   4. plain `length` (no `finish_details`): no retry.
   5. correlation: fixture receives `x-session-affinity` and `x-mlx-serve-loop-request`
      matching the session and user message.
   6. pass-through: fixture text appears verbatim in the transcript.
   7. multi-step turn (tool call then loop): retry rewinds to the last user message and
      regenerates the whole turn.

C. Manual: TUI run shows attempt and give-up toasts; `opencode run` shows log lines only.

## 8. Files

- Plugin: `~/.config/opencode/plugins/mlx-serve-loop-retry.ts`
- Spec (this document): `~/.config/opencode/docs/mlx-serve-loop-retry.spec.md`
- Integration fixture lives outside the config dir (temp dir), per test plan B.
