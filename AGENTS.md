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

- `opencode/.config/opencode/plugins/*.ts` are auto-loaded globally by OpenCode **as server plugins**. TUI plugins (`default export { id, tui }`) live in `opencode/.config/opencode/tui-plugins/` and are only loaded when listed in `opencode/.config/opencode/tui.json` under `plugin`; keeping them out of `plugins/` prevents the server loader from importing (and failing on) TUI-only modules. Never put supporting modules in `plugins/` — every `.ts` directly there is loaded by the server loader. Support code lives in sibling dirs (`explore-controls/`, `todo-reconcile/`, `async-reasoning-titles/`).
- `tui-plugins/async-reasoning-titles.ts` (TUI) and `plugins/async-reasoning-titles-strip.ts` (server) are the two halves of one feature. The TUI plugin generates collapsed reasoning titles using only the plugin `model` option (`tui.json` pins `omlx/Qwen3.5-0.8B-8bit`); with no model option the feature stays disabled — there is no `small_model` fallback. It embeds them as a `**Title**\n\n` prefix so the existing TUI header parser renders them, and records the exact title in part metadata (`metadata["async-reasoning-titles"]`). It skips signed reasoning (`metadata.anthropic.signature`) because rewriting that text breaks provider replay; per-block manual expansion is not visible to TUI plugins, so eligibility uses thinking mode, an untitled unsigned block with usable text, and either completion or a full capped prefix. Input is the first `maxInputChars` chars (default 4,000), and generation starts once a streaming block passes the `minChars` floor (default 200, `tui.json` pins 400), so blocks longer than the floor are titled while still streaming; the result is held until the block completes, then applied only if it is still unsigned, untitled, and starts with the summarized prefix. The server plugin strips marker-verified prefixes from outgoing requests in `experimental.chat.messages.transform` (request-scoped; DB keeps titles) so provider context and prefix caches never see titles. Strip only removes a prefix when metadata records the same title, so model-authored bold lead-ins are untouched; both plugins share `async-reasoning-titles/helpers.ts`.
- `plugins/todo-reconcile.ts` is only a re-export of `todo-reconcile/src/plugin.ts`; edit `src/`, then fully restart OpenCode. Do not also install the built `todo-reconcile/dist/` bundle — it would load twice.
- Plugins rely on experimental OpenCode hooks verified against OpenCode 1.18.31; after plugin changes, start a fresh OpenCode process.
- Tests (Bun, already installed):
  - explore-controls, from `opencode/.config/opencode/`: `bun test ./explore-controls/*.test.ts` (individual files work too).
  - todo-reconcile, from its directory: `bun run test:unit` (fast, no server), `bun test` (unit + integration), `bun run typecheck`. Integration tests need a real OpenCode binary (`OPENCODE_BIN` overrides the path).
  - mlx-serve-loop-retry, from `opencode/.config/opencode/`: `bun test ./mlx-serve-loop-retry/helpers.test.ts` (hermetic helpers), `bun test ./mlx-serve-loop-retry/integration` (real OpenCode binary and a local fixture, `OPENCODE_BIN` overrides the path). The live mlx-serve test is opt-in: `MLX_SERVE_LIVE=1 bun test ./mlx-serve-loop-retry/integration/live-mlx-serve.integration.test.ts` (model loops are stochastic, so it asserts detection + retry, not exhaustion).
  - async-reasoning-titles, from `opencode/.config/opencode/`: `bun test ./async-reasoning-titles/helpers.test.ts ./async-reasoning-titles/plugin.test.ts ./async-reasoning-titles/strip-plugin.test.ts` (hermetic), `bun test ./async-reasoning-titles/integration/titles.integration.test.ts` (real OpenCode binary, mock OpenAI-compatible LLM, TUI attach under a `script` PTY). The live test is opt-in: `ASYNC_REASONING_TITLES_LIVE=1 bun test ./async-reasoning-titles/integration/live-models.integration.test.ts` (defaults to `deepseek/deepseek-flash` main and the real `tui.json` plugin model; override the main model with `ASYNC_REASONING_TITLES_MAIN_PROVIDER`/`ASYNC_REASONING_TITLES_MAIN_MODEL`).
- Canonical runtime deps for the global config are `opencode/.config/opencode/package.json` (installed by `setup.sh`); `todo-reconcile` pins its own SDK version. Root `package.json`/`node_modules` pins a different, unrelated `@opencode-ai/plugin` (1.1.48) — don't assume version bumps there affect plugins.
- `plugins/rtk.ts` only delegates to the `rtk` binary; rewrite rules live in rtk's Rust registry, not this repo.

## Other

- `setup.sh` performs full machine provisioning (Homebrew bundle, SDKMan, stow all, bat theme, gh-copilot) and pulls submodules; do not run it just to test config edits.
- Ignored/generated files that must stay uncommitted: `service.json` (contains a credential), `*.bak*`, `node_modules/`, lockfiles under `opencode/.config/opencode/`, `Brewfile.lock.json`.
- Existing instruction sources: `.github/copilot-instructions.md` (validation rules), `COPILOT_SETUP.md` (manual test procedures), `TROUBLESHOOTING.md`, `MIGRATION.md`, `opencode/README.md`.
