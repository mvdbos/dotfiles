# Subagent Concurrency

`plugins/subagent-concurrency.ts` admits one invocation of each configured
subagent type at a time. `explore` and `general` therefore have independent
locks and may run together. Add a policy entry in `policy.ts` to control another
subagent type.

The queue uses keyed SQLite owners and FIFO waiters at:

```text
~/.cache/opencode/subagent-concurrency.sqlite
```

Set `OPENCODE_SUBAGENT_QUEUE_PATH` only for isolated tests or probes. SQLite
`BEGIN IMMEDIATE` transactions serialize registration and admission. Every
owner has a random token, PID, and macOS `ps` process-start identity. Releases
must match the owner token and are idempotent.

Default admission timeouts are 60 seconds for `explore` and 10 minutes for
`general`. Override one with an agent-specific environment variable, expressed
in milliseconds:

```text
OPENCODE_SUBAGENT_EXPLORE_TIMEOUT_MS
OPENCODE_SUBAGENT_GENERAL_TIMEOUT_MS
```

Future agent names use the same uppercase, underscore-normalized form. Invalid
or non-positive values fall back to the policy default.

There is no heartbeat or age-based expiry, so a live slow owner cannot be
stolen. A crashed owner is recovered when its PID is gone or its process-start
identity no longer matches. Unverifiable live PIDs are treated as live
conservatively.

Foreground ownership ends at the parent Task terminal path. Background
ownership ends at the child terminal event. Parent and child deletion, failure,
cancellation, duplicate terminal events, and process crashes have cleanup or
durable recovery paths. Resumed Task calls are new admissions; existing child
IDs are linked only when runtime metadata identifies them. Parallel children
from one parent are correlated by both parent session and agent type.

`general` has no configured model, so OpenCode inherits the invoking message's
provider, model, and variant. `explore` retains its explicit model. Foreground
tasks wait for completion, preventing one `general` child from overlapping its
own parent generation. This does not protect a single-concurrency model runtime
from unrelated OpenCode sessions. Keep only one main-model session active and
leave experimental background subagents disabled.

Run all concurrency tests:

```sh
bun test ./subagent-controls/*.test.ts
bun build --target bun --outdir /tmp/opencode-subagent-controls-build plugins/subagent-concurrency.ts
```

The suite covers per-type serialization, cross-type independence, FIFO waits,
timeouts, cancellation, foreground and background lifecycle, mixed-child
correlation, direct sessions, cross-process admission, and crash recovery.
