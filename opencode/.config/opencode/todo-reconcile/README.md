# OpenCode todo reconciliation plugin

After a successful compaction, OpenCode resumes with a summarized history while the
session's persisted todo list stays in the database. This plugin persists a compact snapshot
on the resumed user message and asks the agent to reconcile the saved statuses against the
summary and the user's latest instructions.

It restores post-compaction task visibility. It does not enforce check-offs during
uninterrupted work, does not mutate todo statuses, and never creates an agent turn.

Verified against OpenCode **1.18.30**. The implementation depends on the experimental
`experimental.chat.messages.transform` hook; see `docs/delivery-contract.md` for the frozen
hook contract and `docs/integration-report.md` for captured-request evidence.

## Installation

OpenCode loads plugins from `<config-dir>/{plugin,plugins}/*.{ts,js}` (auto-discovery) or
from a `plugin` entry in `opencode.json`. The config directory is `~/.config/opencode`
globally and `<project>/.opencode` project-locally.

### From this checkout (config-dir layout)

This repository lives at `~/.config/opencode/todo-reconcile/` and is installed by the thin
wrapper `~/.config/opencode/plugins/todo-reconcile.ts`:

```ts
export { TodoReconcilePlugin } from "../todo-reconcile/src/plugin"
```

No build or copy is needed. Edit `src/`, then quit and restart OpenCode. Do not also install
the built bundle as `plugins/todo-reconcile.js` — both files would load the plugin twice.

### Global install (standalone bundle)

For a machine that only has the built artifact, build the self-contained file first:

```sh
bun install
bun run build
```

Then:

```sh
mkdir -p ~/.config/opencode/plugins
cp dist/todo-reconcile.js ~/.config/opencode/plugins/todo-reconcile.js
```

### Project-local install (standalone bundle)

```sh
mkdir -p /path/to/project/.opencode/plugins
cp dist/todo-reconcile.js /path/to/project/.opencode/plugins/todo-reconcile.js
```

### Config-file alternative

Add an absolute file URL to the `plugin` array instead of copying:

```json
{
  "plugin": ["file:///absolute/path/to/dist/todo-reconcile.js"]
}
```

### Restart required

**Quit OpenCode completely and start it again after installing, updating, or removing the
plugin.** Plugins are loaded once at startup.

### Removal

```sh
rm ~/.config/opencode/plugins/todo-reconcile.ts      # config-dir layout
rm ~/.config/opencode/plugins/todo-reconcile.js      # standalone bundle
rm /path/to/project/.opencode/plugins/todo-reconcile.js  # project-local bundle
```

or delete the `plugin` array entry, then restart OpenCode.

Do not place extra modules in the `plugins/` directory: OpenCode auto-loads every
`*.ts`/`*.js` file directly in that directory as a plugin. Supporting modules live in this
repository instead.

## Behaviour summary

- One durable snapshot per successful compaction and todo fingerprint, reused on retries and
  later requests until a successful native todo update provides newer coverage.
- Uses a 2 KiB UTF-8 ceiling and prioritizes active items; omitted data is reported explicitly.
- Includes pending, in-progress, completed, and cancelled items when they fit, with statuses
  presented as claims rather than verified evidence.
- Empty lists are skipped. Read failures are logged and skipped; the agent request is never
  failed.
- Restart-safe, retry-safe, isolated per session, nothing to clean up.
- When the target prompt explicitly disables `todowrite`, the guidance to correct statuses
  is omitted.

## Development

Requirements: Bun, plus a local OpenCode 1.18.30 binary for integration tests
(`OPENCODE_BIN` overrides the default path).

```sh
bun install
bun run build             # dist/todo-reconcile.js
bun test                  # all tests (unit + integration)
bun run test:unit         # formatter + lifecycle tests, no model, no server
bun run test:integration  # real OpenCode instances + deterministic mock provider
bun run typecheck         # tsc --noEmit against pinned @opencode-ai/plugin@1.18.30
```

Layout:

- `src/reminder.ts` — pure reminder formatter
- `src/lifecycle.ts` — boundary detector, fail-open todo read, transform hook
- `src/plugin.ts` — plugin entry point (single export, bundled to `dist/`)
- `test/` — formatter and lifecycle tests
- `test/integration/` — OpenCode+mock-provider integration checks
- `docs/delivery-contract.md` — verified hook contract and limitations
- `docs/integration-report.md` — tested versions and captured-request evidence
- `PLAN.md`, `tasks/` — original design plan and task briefs

Installed on this machine as `~/.config/opencode/plugins/todo-reconcile.ts` (re-export
wrapper); the build output `dist/todo-reconcile.js` is only for standalone installation.
