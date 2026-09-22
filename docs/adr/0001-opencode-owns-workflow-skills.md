---
status: accepted
---

# OpenCode owns the workflow skill suite

The `opencode` Stow package owns every active workflow skill except externally installed `hf-cli`, so commands, plugins, configuration, and their required skills install as one reproducible OpenCode harness. Each active skill moves as its complete directory, shared multi-skill material lives under `~/.config/opencode/references/`, and the suite becomes a permanent local fork rather than an installer-managed or automatically synchronized copy.

`~/.agents/` remains an external-skill installation root for `hf-cli`, but the `dotagents` repository is archived after migration and is no longer a runtime dependency. Symlinks, submodules, and setup-time copies were rejected because they retain split ownership or mutable installed state. Duplicate migrated skills must be removed from `~/.agents/skills` because OpenCode requires unique discovered skill names.

The migration must add an automated closure test covering skill dependencies and local support-file pointers. It must also repair stale callers of the former `grilling` skill to use the shared `grilling.md` reference; the standalone skill was intentionally converted into shared reference material by `dotagents` commit `c695818faee20b61aff605e4242ebb501bc40480`.

Most of the workflow suite originated in `mattpocock/skills` and was adapted in `mvdbos/dotagents`; locally authored skills such as `audit-opencode-session` originated in `dotagents`. The import uses `dotagents` commit `4955cfc` plus the uncommitted triage edits present at migration time, with the broken grilling pointer repaired in the OpenCode copy. The migration keeps `hf-cli` independently installed.
