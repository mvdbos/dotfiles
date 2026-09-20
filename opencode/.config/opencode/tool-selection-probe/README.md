# Tool-selection probe

Measures how the configured local primary model chooses tools in a real OpenCode
session: direct handling, delegation through the task tool (`explore` or
`general`), or a question-tool call. It exists to keep the global rules and agent
descriptions honest for lesser models such as `ds4/qwen3.8-flash-next`.

The probe mirrors the live global config into a throwaway HOME:

- `opencode.json` is copied with `plugin` and `lsp` stripped, the probe model
  pinned for the main/title/summary/explore agents, and `explore.options`
  removed so the local provider does not receive `enable_thinking`.
- `AGENTS.md` (global rules) is copied verbatim, so edits under test apply.
- Agent `{file:...}` prompts are copied beside the mirrored config.
- A small `ledger-sync` fixture repo is written into the working directory.

Everything else about a run is real: a real `opencode serve` process, the real
build agent permissions, and the real model at the provider `baseURL` in
`opencode.json`.

## Run

Hermetic helper tests (no server, no model):

```
bun test ./tool-selection-probe/helpers.test.ts
```

Live probe (needs the local model server and the OpenCode binary):

```
TOOL_SELECTION_PROBE_LIVE=1 bun test ./tool-selection-probe/probe.integration.test.ts
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TOOL_SELECTION_PROBE_LIVE` | unset | `1` enables the live probe |
| `PROBE_REPS` | `3` | repetitions per cue |
| `PROBE_CUES` | all cues | comma-separated cue ids to run |
| `PROBE_TIMEOUT_MS` | `240000` | per-run timeout before the session is aborted |
| `PROBE_MODEL` | `model` from `opencode.json` | `provider/model` ref to probe |
| `PROBE_BASE_URL` | provider `baseURL` | override the model server endpoint |
| `PROBE_CONFIG_DIR` | `~/.config/opencode` | global config to mirror |
| `PROBE_REPORT` | unset | file path for the text report |
| `OPENCODE_BIN` | `/Users/matthijs/.opencode/bin/opencode` | OpenCode binary |

The live test prints the report and fails unless every cue passes in a majority
of repetitions. Question runs are aborted once the call is observed, because a
question waits for a user that the probe does not provide; the call itself is
the evidence. `narrow-lookup` must also complete, otherwise a later question or
delegation cannot be ruled out.

## Cues

| Cue | Expected | Forbidden |
| --- | --- | --- |
| `exploration` | `task` with `explore` | `general`, question |
| `research-review` | `task` with `general` | `explore` |
| `user-input` | question tool | - |
| `ambiguous-request` | question tool | - |
| `narrow-lookup` | direct handling, completed | any task, question |
