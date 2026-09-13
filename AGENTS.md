# AGENTS.md

Personal dotfiles managed with GNU Stow. Each top-level directory (`shell/`, `bash/`, `zsh/`, `vim/`, `git/`, `ssh/`, `wget/`, `certs/`, `opencode/`, `phoenix/`, `ideavim/`) is a stow package.

## Hard constraints

- Repo must live at `~/.dotfiles`: `shell/.profile`, aliases, and `validate_setup.sh` source `$HOME/.dotfiles/platform_detector.bash`, and stow symlinks point into `~/.config/dir_aliases`.
- Never hand-edit files in `$HOME`; edit the package file and `stow -R <pkg>` from the repo root. `stow_dotfiles.sh` is the source of truth for which packages are installed.
- `shell` must be stowed with `--no-folding` (see `stow_dotfiles.sh`); folding breaks user symlinks under `~/.config/dir_aliases`.
- Vim plugins are git submodules; run `git submodule update --init` after a fresh clone.

## Validation (mandatory for shell changes)

Run `./validate_setup.sh` after editing `bash/.bashrc`, `zsh/.zshrc`, `shell/.profile`, `shell/.config/shell/*`, `setup.sh`, or `stow_dotfiles.sh`. It copies the repo into a throwaway `HOME`, stows shell/bash/zsh, and asserts 11+ checks; CI (`copilot-setup-steps.yml`) runs the same script on Ubuntu and blocks PRs on failure. Zsh alias checks are informational outside interactive shells.

## Shell config conventions

- `shell/` is shared by bash and zsh: keep it POSIX (no `[[`, no `seq`, no bashisms). Use `builtin cd` in functions because `cd` is aliased to `cdbm`.
- `bash/.bashrc` and `zsh/.zshrc` both source `~/.config/shell/{aliases,functions}` and set `alias cd='cdbm'`.
- Circular-source guard: `.bashrc` exports `BASHRC_SOURCED=1` before sourcing `.profile`; `.profile` only sources `.bashrc` when the guard is unset. Don't remove either half.
- Platform detection: source `platform_detector.bash`; on Darwin, aliases map to Homebrew GNU coreutils (`gls`, `grm`, `gmv`, ...). Linux falls back to native tools.
- `zsh/.zshenv` hardcodes `/opt/homebrew` and macOS-only setup; zsh also expects oh-my-zsh at `$HOME/.oh-my-zsh` (not vendored here).

## OpenCode plugins and config

- `opencode/.config/opencode/plugins/*.ts` are auto-loaded globally by OpenCode. Never put supporting modules in `plugins/` — every `.ts` directly there becomes a plugin. Support code lives in sibling dirs (`explore-controls/`, `todo-reconcile/`).
- `plugins/todo-reconcile.ts` is only a re-export of `todo-reconcile/src/plugin.ts`; edit `src/`, then fully restart OpenCode. Do not also install the built `todo-reconcile/dist/` bundle — it would load twice.
- Plugins rely on experimental OpenCode hooks verified against OpenCode 1.18.30; after plugin changes, start a fresh OpenCode process.
- Tests (Bun, already installed):
  - explore-controls, from `opencode/.config/opencode/`: `bun test ./explore-controls/*.test.ts` (individual files work too).
  - todo-reconcile, from its directory: `bun run test:unit` (fast, no server), `bun test` (unit + integration), `bun run typecheck`. Integration tests need a real OpenCode binary (`OPENCODE_BIN` overrides the path).
- Canonical runtime deps for the global config are `opencode/.config/opencode/package.json` (installed by `setup.sh`); `todo-reconcile` pins its own SDK version. Root `package.json`/`node_modules` pins a different, unrelated `@opencode-ai/plugin` (1.1.48) — don't assume version bumps there affect plugins.
- `plugins/rtk.ts` only delegates to the `rtk` binary; rewrite rules live in rtk's Rust registry, not this repo.

## Other

- `setup.sh` performs full machine provisioning (Homebrew bundle, SDKMan, stow all, bat theme, gh-copilot) and pulls submodules; do not run it just to test config edits.
- Ignored/generated files that must stay uncommitted: `service.json` (contains a credential), `*.bak*`, `node_modules/`, lockfiles under `opencode/.config/opencode/`, `Brewfile.lock.json`.
- Existing instruction sources: `.github/copilot-instructions.md` (validation rules), `COPILOT_SETUP.md` (manual test procedures), `TROUBLESHOOTING.md`, `MIGRATION.md`, `opencode/README.md`.
