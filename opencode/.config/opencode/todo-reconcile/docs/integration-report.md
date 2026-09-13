# Integration verification report: todo-reconcile

## Tested versions

- OpenCode binary: **1.18.30** (`/Users/matthijs/.opencode/bin/opencode --version` → `1.18.30`)
- Source baseline: `anomalyco/opencode` tag `v1.18.30`, commit `3104c14`
- Plugin/SDK types: `@opencode-ai/plugin@1.18.30`, `@opencode-ai/sdk@1.18.30`
- Runtime: Bun 1.3.14

The tested hook dependency is `experimental.chat.messages.transform`, which OpenCode marks
experimental. Re-verify the two call sites (`session/prompt.ts:1255`,
`session/compaction.ts:379` in v1.18.30) before upgrading.

## How to reproduce

```sh
bun install
bun run build                 # writes dist/todo-reconcile.js (single self-contained file)
bun run typecheck
bun run test:unit             # formatter + lifecycle tests, no model/server needed
bun run test:integration      # starts real OpenCode servers with a mock provider
OPENCODE_BIN=/path/to/opencode bun run test:integration
```

`test:integration` skips automatically when the OpenCode binary is not found. It starts each
OpenCode instance with an isolated `HOME`/`XDG_*`/`OPENCODE_DB` and an isolated config
directory whose `plugins/` directory contains the built bundle, so the run exercises the
same auto-discovery path as a real installation. A local HTTP server implements the
OpenAI-compatible `/v1/chat/completions` endpoint and records every request; no paid model
is used.

## What the captured requests prove

The integration suite covers the following scenarios (see `test/integration/reconcile.integration.test.ts`):

1. **Manual compaction, then user input** — the summarizer request carries no reminder; the
   first post-compaction user prompt carries exactly one reminder with all four todo
   statuses and the full items; later requests reuse that persisted snapshot.
2. **Automatic continuation** — with `summarize(auto=true)`, the synthetic
    "Continue if you have next steps" request carries the reminder; summarizer input is clean;
    later user turns reuse the persisted snapshot.
 3. **Failed compaction** — the summarizer request fails with a non-retryable error; the
   compaction assistant message is persisted with an error, no reminder is attached to the
   next user prompt, and the session keeps answering normally.
 4. **First-resumed-request retry** — the first post-compaction request gets a retryable 500;
   both the failed attempt and the retry contain the reminder, proving a retried/rebuilt
   request cannot lose it.
 5. **Restart after compaction** — server killed and restarted against the same
   `OPENCODE_DB`; the first prompt after restart carries the reminder, proving eligibility
    is recovered from persisted history after the process-local cache is gone.
 6. **Empty list** — compaction with no persisted todos produces no reminder on the next
   prompt (ordinary requests still happen).
 7. **All-completed list** — a list whose items are already `completed` is represented by
   closed-item counts.

Additional assertions in the same suite:

- The persisted session history contains the `metadata["todo-reconcile"]` part after
  reminder delivery, proving restart recovery and stable persistence.
- `session.todo` returns exactly the items written by `todowrite` before and after a
  reminder delivery — the plugin never mutates todos.
- Every scenario distinguishes the summarizer by request content and asserts the recipient
  (summarizer vs resumed agent).

## Automated checks run

```
bun run typecheck         # tsc --noEmit, pinned types, clean
bun test                  # unit tests plus integration scenarios when the binary is available
```

## Honest limitations

- The hook input has no session ID; the plugin derives it from the message `info.sessionID`
  (see `docs/delivery-contract.md` §4). Messages always carry it in v1.18.30.
- `todowrite` availability is inferred from `user.tools` on the target prompt
  (`false` disables the guidance bullet). Agent-level permission denials are not visible at
  this hook; the default wording is conditional.
- The snapshot remains in persisted history until newer native todo coverage or compaction
  supersedes it. There is no provider acknowledgement, so strict exactly-once delivery is
  not promised.
- The integration harness uses one process per scenario and a deterministic mock provider;
  it does not exercise real LLM behaviour.
