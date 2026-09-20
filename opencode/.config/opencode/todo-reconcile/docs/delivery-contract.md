# Delivery contract: post-compaction todo reconciliation

Status: verified against OpenCode v1.18.30 (`anomalyco/opencode` tag `v1.18.30`, commit `3104c14`).
Verification method: source inspection of the pinned tag. End-to-end delivery (recipient,
timing, dedup) is exercised by the integration checks specified in
`tasks/004-integration-checks-and-install-guide.md`.

This note freezes the hook contract that `src/plugin.ts` is built on. It records what was
verified, the chosen algorithm, and the honest limitations. Line references are to the
v1.18.30 tag and may drift in later versions.

## 1. Public surface used

Plugin type surface: `packages/plugin/src/index.ts`:

- `experimental.chat.messages.transform` (line 282): input `{}` (no session ID), output
  `{ messages: { info: Message; parts: Part[] }[] }`. Hooks mutate `output.messages` in place.
- `event` (line 224): optional event listener used to invalidate the in-memory todo cache.

SDK todo surface, pinned `@opencode-ai/sdk@1.18.30` (v1 client):

- `packages/sdk/js/src/gen/sdk.gen.ts:513`
  `client.session.todo({ path: { id: sessionID } })` → GET `/session/{id}/todo`
- `packages/sdk/js/src/gen/types.gen.ts:2275-2307`
  - success (200): `Todo[]` where `Todo = { content: string; status: string; priority: string }`
  - errors: 400 `BadRequestError`, 404 `NotFoundError`
  - default `throwOnError=false` returns `{ data } | { error }` plus `request`/`response`
    (`gen/client/types.gen.ts:90-123`). Network failures can reject; callers must catch.
- Ordering: the route handler reads `Todo.get` which orders by stored `position`
  (`packages/opencode/src/session/todo.ts:53-66`), so persisted order is preserved.

Plugin loading contract (`packages/opencode/src/config/plugin.ts:16-28`,
`packages/opencode/src/config/config.ts:476-479`):

- Files matching `<config-dir>/{plugin,plugins}/*.{ts,js}` are auto-discovered.
- A plugin file must export exactly one plugin function (or a default `{ id, server }` module).
  The legacy loader iterates every runtime export and throws on a non-plugin export
  (`packages/opencode/src/plugin/index.ts:99-112`), so the installed file exports one function.

## 2. Hook dispatch and ordering

`experimental.chat.messages.transform` runs at exactly two call sites in v1.18.30:

1. Ordinary agent step, `packages/opencode/src/session/prompt.ts:1255`:
   - runs once per model step in the agent loop, after `SessionReminders.apply`
     (`prompt.ts:1180`) and before `MessageV2.toModelMessagesEffect` (`prompt.ts:1262`);
   - `msgs` comes fresh from `MessageV2.filterCompactedEffect(sessionID)` each step
     (`prompt.ts:1092`), i.e. from the database via `stream()`/`hydrate()`.
2. Compaction summarizer, `packages/opencode/src/session/compaction.ts:379`:
   - runs on `structuredClone(selected.head)` (`compaction.ts:378`), the head being
     summarized.

No other LLM request path runs the transform:

- title generation builds `toModelMessages` output directly and calls `llm.stream` without
  the hook (`prompt.ts:222-236`); corroborated by the only three `toModelMessages` call
  sites (`prompt.ts:224`, `prompt.ts:1262`, `compaction.ts:219`).
- the compaction token estimate (`compaction.ts:215-221`) never runs the hook.
- `summary.summarize` performs no LLM call (`session/summary.ts:102-127`).

Mutation semantics: `plugin.trigger` passes the `output` object to each hook and awaits it
(`plugin/index.ts:284-297`). Mutating `output.messages`/`parts` affects the request built
immediately afterwards. The plugin separately persists its snapshot on the target user
message through `session.prompt({ messageID, noReply: true })`; this does not create a model
turn. Summarizer mutations remain in-memory only.

Hook errors propagate: `plugin.trigger` wraps each hook in `Effect.promise` without a
catch, so a throwing hook fails the agent request. The plugin must therefore catch all of
its own errors.

## 3. How compaction appears in message history

Completed compaction detection mirrors the internal helper `completedCompactions`
(`compaction.ts:97-113`): an assistant message `A` qualifies when
`A.summary === true && A.finish && !A.error`, and its `parentID` points at a user message
`U` whose parts include `{ type: "compaction" }`.

History shapes at the transform hook:

Manual compaction (`auto=false`), then user prompt:

```
[..., U_compaction(part:compaction), A_summary(summary,finish),
 U_new(ordinary prompt)]                      <- transform sees this for the resumed request
```

Automatic compaction with autocontinue (`auto=true`, no replay): `compaction.process`
appends a synthetic user message after the summary before the loop re-enters
(`compaction.ts:519-548`):

```
[..., U_compaction, A_summary, U_continue(synthetic, metadata.compaction_continue=true)]
```

Overflow with user-message replay (`overflow=true`): the previous user message is copied
as a new user message (`compaction.ts:468-495`) and no synthetic continue message is
created; the loop continues with the replay:

```
[..., U_replay(copy of pre-overflow user message), ...]   after U_compaction/A_summary
```

Failed compaction: `compaction.process` sets `error` and `finish="error"` and returns
`"stop"` (`compaction.ts:450-458`); no reminder, because `A.error` disqualifies the pair
and `session.compacted` is never published (`compaction.ts:552-555`).

Ordering caveat: `filterCompacted` reorders model history to
`[compaction-user, summary, retained tail..., post-compaction messages...]`
(`message-v2.ts:521-572`). Array position is not chronological, so the detector compares
`time.created`/id (`isAfter`, `message-v2.ts:600-604`) and never assumes adjacency.

Summarizer exclusion is structural, not heuristic: prior completed compaction pairs are
removed before selection (`compaction.ts:364-368` filters `hidden`), and the current
compaction's user message is excluded from `history` (`compaction.ts:363`). The summarizer
input can therefore never contain a completed pair, and the detector requires one. This is
also asserted by the integration capture in `test/integration/` (summarizer request must
not contain the reminder).

## 4. Chosen algorithm (one durable write per boundary)

For each transform invocation:

1. `messages` empty or has no user message → no-op.
2. Session key = `messages.at(-1).info.sessionID`; target = chronologically newest user
   message in the array, whatever produced it (real prompt, generated continuation,
   synthetic autocontinue).
3. Find the latest completed compaction boundary pair by scanning for the assistant `A`
   that satisfies the §3 test, comparing candidates with `isAfter`.
4. Skip if no boundary exists.
5. Read the session's todos only before the boundary's first provider request. Empty list →
   no-op. Read failure → log and seal the boundary without changing history.
6. Format an active-first projection with the fixed byte ceiling in `src/reminder.ts`.
   Omitted items and excerpts are explicitly marked.
7. Persist one synthetic text part on the newest user message through
   `session.prompt({ messageID, noReply: true })`. This creates no new user message or
   model turn. A stable session/boundary/target/fingerprint ID makes the write idempotent.
   The write is skipped for a compaction marker and that boundary is sealed; the
   marker is excluded because OpenCode's `createUserMessage` always rewrites `time.created`
   on an existing `messageID`, and a marker bumped ahead of the finished summary re-arms
   `latest().tasks`, which reruns `SessionCompaction.process` (an unbounded compaction loop
   under generated continuations). Rewriting the newest user message keeps it newest, so it
   cannot reorder history.
   The request body mirrors the target's existing text parts verbatim (same part IDs, flags,
   and metadata) ahead of the snapshot part. OpenCode fires `chat.message` for this write
   with only the supplied parts; a synthetic-only payload would classify the turn as an
   empty real turn, resetting watchdog's foreign-continuation epoch, task, advisory, and
   idle-admission state. Mirroring makes classification identical to the original prompt.
   Upserts are by part ID, so stored parts, model-visible payloads, part order, and prefix
   caching are unchanged; the only new provider-visible content remains the snapshot part.
8. Never remove, replace, or hide a provider-visible snapshot. A later model-visible native
   `todowrite` supersedes its claims by appearing later in history.

Properties:

- One attempted write per boundary; later requests keep the persisted part as ordinary
  history. Active-loop feedback is appended only to unseen successful tool output (§9).
- In-memory state avoids repeated reads during one process; persisted snapshot metadata
  recovers coverage after restart.
- Fail-closed at the cache frontier: a failed initial read/write is never retried against an
  already-sent target.
- A later compaction introduces a new boundary, even with byte-identical todo text.

## 5. Todo-read semantics

- Fetch lazily, only when the boundary has no matching cache or persisted snapshot.
- Success with `[]` → ordinary empty list → skip.
- HTTP `{ error }` or missing `data` or thrown error → read failure → fail open, no
  reminder, concise log (`console.warn`), no todo content in logs.
- One SDK attempt is allowed before the first request at a boundary. Failure seals it.

## 6. Size bound

`formatTodoReminder` serializes items as JSON and keeps the complete rendered reminder under
`DEFAULT_REMINDER_MAX_BYTES` (see `src/reminder.ts`). Active items are considered before
closed items. If content is omitted or excerpted, an explicit line reports it; statuses are
never rewritten.

## 7. todowrite availability

The transform hook does not expose the resolved agent tool set. The plugin reads
`lastUser.info.tools?.todowrite`:

- `false` → `todowrite` was explicitly disabled for that prompt; guidance to use it is
  omitted (replaced with a report-instead instruction).
- `true` or absent → the plan's conditional wording ("If todowrite is available, ...")
  is used.

Agent-level permission denials are not visible at this hook and are not detected; the
conditional wording covers that case. This limitation is intentional and documented.

## 8. Why not the `session.compacted` event

`session.compacted` is published by `compaction.process` on success
(`compaction.ts:552-555`, event schema in `packages/schema/src/session-compaction-event.ts`),
including manual compaction. An event-only in-memory flag was rejected:

- it is lost on OpenCode restart, after which the resumed agent would silently lose the
  reminder;
- it can race the continuation request (the hook and the event are different pipelines);
- `experimental.compaction.autocontinue` does not run for manual compaction, so it is not a
  usable sole trigger;
- the event also does not prove delivery to the model, which is the property that matters.

History-derived eligibility remains the source of truth; the event only invalidates the
process-local cache and is not required for restart recovery.

## 9. Stale-todo nudge (pre-compaction)

Status: verified against OpenCode v1.18.31 (`anomalyco/opencode` tag `v1.18.31`) with unit,
lifecycle, and mock-provider integration tests. Delivery uses `tool.execute.after`, before
OpenCode persists a successful tool result.

The plugin appends one bounded text trailer to the next eligible successful tool output.
That output is then persisted normally, so every later provider request sees identical bytes.

Eligibility, in order:

1. The latest user message is not a plan-agent turn and does not disable `todowrite`.
3. A baseline exists: the newest successful, model-visible, uncompacted `todowrite` part
   (`visibleTodoWritePart`). No baseline means no nudge, so a list the model never wrote
   stays the boundary path's concern.
4. The baseline is stale: `toolThreshold` successful eligible tool completions after it
   (excluding `todowrite`, `question`, `skill`, and image tools), or `minutesThreshold`
   elapsed since the baseline part's `time.end`.
5. The baseline has not already produced a reminder. A later successful `todowrite` creates
   a new baseline and re-arms delivery.

The reminder text is short, stable, and framed as system-generated task data. It includes no
dynamic counts or persisted list. Time is checked only in the successful tool hook; no timer
creates a provider request.

Config: optional `todo-reconcile.json` (`OPENCODE_TODO_RECONCILE_CONFIG` overrides) with
`nudge.enabled`, `nudge.toolThreshold`, and `nudge.minutesThreshold`; defaults are
`true`, `10`, and `5`. Invalid fields fall
back per field and log one warning.

## 10. Limitations (stated honestly)

- No acknowledgement mechanism exists, so strict exactly-once provider delivery cannot be
  promised. The stable persisted part provides retry and restart recovery, not provider
  acknowledgement.
- The snapshot is persisted on the newest user message and remains available until newer
  native todo coverage or a newer compaction supersedes it. In goal sessions this places the
  snapshot on the generated continuation that resumed the session, which is also where the
  model needs it.
- There is no hot-patch fallback. If initial installation fails, the request runs unchanged
  and the boundary remains sealed.
- External todo updates are appended at a future unseen eligible tool boundary; old visible
  snapshots are never rewritten.
- `lastUser.info.tools?.todowrite` is the only availability signal at this hook; dynamic
  agent permissions are not visible.
- Restart reconstruction can recover a visible `todowrite` baseline from history. A stale
  reconstructed baseline waits for a future unseen eligible tool output.
- An armed compaction guard that is never consumed (an aborted compaction) suppresses one
  subsequent nudge; the count is dropped on the next consume.
- The transform has no session parent information, so subagent sessions with their own todo
  lists are nudged like root sessions.
- Experimental hooks may change in later OpenCode versions. This contract applies to
  v1.18.30/v1.18.31; re-verify the two call sites before upgrading.
