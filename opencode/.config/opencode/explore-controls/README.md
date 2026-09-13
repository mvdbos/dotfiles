# Explore Controls

Two independent global plugins live in `~/.config/opencode/plugins/`:

- `explore-concurrency.ts` admits one local `explore` invocation at a time.
- `explore-context-budget.ts` estimates the next request and finalizes an
  `explore` invocation before its derived context budget is exhausted.

The existing `rtk.ts` plugin remains unchanged. The plugins are auto-discovered
from the global plugin directory; no explicit config registration is required.

## Concurrency

The queue uses SQLite at:

```text
~/.cache/opencode/explore-concurrency.sqlite
```

Set `OPENCODE_EXPLORE_QUEUE_PATH` only for isolated tests or probes. SQLite
`BEGIN IMMEDIATE` transactions serialize registration and admission. Waiters
are FIFO by an autoincrement position. Every owner has a random token, PID, and
macOS `ps` process-start identity. A release must match the owner token and is
idempotent.

The production wait limit is 60 seconds. There is no heartbeat and no
age-based expiry, so a live slow exploration cannot be stolen. A crashed owner
is recovered when its PID is gone or its process-start identity no longer
matches. Unverifiable live PIDs are treated as live conservatively.

Timeout guidance returned to the parent:

```text
Exploration was not started: the local explore worker remained busy for the 60-second admission timeout. Its completion time is unknown. Do not immediately retry or poll. If an already-running exploration covers this question, use its result when available. Otherwise continue independent work, or perform a small targeted lookup yourself with your own tools; prefer relevant files and narrow searches to limit parent-context growth.
```

This means no child was started and gives no completion ETA. Direct parent
exploration is allowed after timeout, but it can grow the parent's context; it
is not an automatic fallback. Cancellation removes a queued waiter and uses a
cancellation error instead of timeout guidance.

Foreground ownership ends at the parent Task terminal path. Background
ownership ends at the child terminal event. Parent and child deletion,
failure, cancellation, duplicate terminal events, and process crashes have
cleanup or durable recovery paths. Resumed Task calls are new admissions;
existing child IDs are linked only when runtime metadata identifies them.

## Context Budget

The budget is resolved from the model selected for the current request:

```text
effective output = min(model.limit.output, chat.params maxOutputTokens) when both exist
                   otherwise whichever positive value exists

reserved = min(20,000, effective output) + final-summary headroom
           when model.limit.input exists
reserved = effective output + final-summary headroom
           otherwise

usable input = max(0, input limit or context limit - reserved)
threshold = min(floor(context limit * 0.75), usable input)
```

For a `131072` context and `32768` output limit, the reference 75-percent
threshold is `98304` tokens. Missing or zero context limits disable this guard
for that request and emit one diagnostic; they do not cause immediate
exhaustion.

The estimator serializes the current system material, messages and parts,
tool-call arguments/results/errors, schemas or attachments when exposed by a
hook, then uses a conservative four-characters-per-token approximation. A
single inclusive provider input-usage value can raise the estimate with
`max`; cache read/write fields are not added and historical turns are not
summed as separate usage. This is an approximation, not provider tokenization.

At the threshold, state changes once from `active` to `exhausted`. The next
system request gets one final-summary instruction asking for findings,
references, unresolved work, and the next narrow investigation. Further tool
execution in that explore session is rejected. State remains sticky through
compaction and smaller later estimates, then is removed only on session idle,
error, or deletion. A resumed session is re-estimated from its retained
history.

The public plugin API cannot remove tools from one provider request or force
`toolChoice: "none"`. A blocked tool call therefore becomes a tool error; the
provider may retry once or stop. The plugin does not claim the stronger core
runner behavior. Automatic compaction and provider overflow can race the
plugin check; no global compaction setting changes.

## Disable And Validate

Disable either control independently by moving that one `.ts` entrypoint out
of `~/.config/opencode/plugins/`; the other plugin has no import dependency on
it. `opencode --pure` disables external plugins for a process.

Run all tests:

```sh
bun test ./explore-controls/*.test.ts
bun build --target bun --outdir /tmp/opencode-explore-controls-build plugins/explore-concurrency.ts plugins/explore-context-budget.ts
```

The test suite includes fake-clock-style short queue limits, plugin lifecycle
tests, both plugin load orders, RTK coexistence, and separate Bun processes for
admission, live-owner timeout, crash recovery, and competing recovery.

OpenCode `1.18.30` loads these files from the supported global path. Start a
fresh OpenCode process after installation or changes; already-running sessions
keep their previously loaded plugins.
