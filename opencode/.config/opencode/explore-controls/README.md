# Explore Controls

The explore-specific context-budget plugin lives in
`~/.config/opencode/plugins/`:

- `explore-context-budget.ts` estimates the next request and finalizes an
  `explore` invocation before its derived context budget is exhausted.

Subagent concurrency is documented separately in
[`../subagent-controls/README.md`](../subagent-controls/README.md). The existing
`rtk.ts` plugin remains unchanged. Plugins are auto-discovered from the global
plugin directory; no explicit config registration is required.

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

Disable the context control by moving `explore-context-budget.ts` out of
`~/.config/opencode/plugins/`. `opencode --pure` disables external plugins for
a process.

Run all tests:

```sh
bun test ./explore-controls/*.test.ts
bun build --target bun --outdir /tmp/opencode-explore-controls-build plugins/explore-context-budget.ts
```

The test suite includes context-budget boundaries, both plugin load orders, and
RTK coexistence.

OpenCode `1.18.31` loads these files from the supported global path. Start a
fresh OpenCode process after installation or changes; already-running sessions
keep their previously loaded plugins.
