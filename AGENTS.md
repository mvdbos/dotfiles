# AGENTS.md

Personal dotfiles managed with GNU Stow. Each top-level directory (`shell/`, `bash/`, `zsh/`, `vim/`, `git/`, `ssh/`, `wget/`, `opencode/`, `phoenix/`, `ideavim/`) is a stow package.

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

## Component maintenance routing

Before investigating or modifying OpenCode plugins or configuration, read
`docs/opencode-maintenance.md` completely and follow its relevant references.
It contains plugin mechanics, statistics calculations, rendering constraints,
canonical runtime dependency locations and component test commands. These runtime
policies apply to OpenCode only.

Pi discovers context files from its startup working directory and ancestors;
reading a nested file does not automatically load nested AGENTS.md instructions.
Use this root routing from a repository-root session. The separate
`opencode/.config/opencode/AGENTS.md` contains OpenCode-global operating
instructions; it is not the component maintenance document and does not govern
this pi session merely because it is read.

## Other

- `setup.sh` performs full machine provisioning (Homebrew bundle, SDKMan, stow all, bat theme, gh-copilot) and pulls submodules; do not run it just to test config edits.
- Ignored/generated files that must stay uncommitted: `service.json` (contains a credential), `*.bak*`, `node_modules/`, lockfiles under `opencode/.config/opencode/`, `Brewfile.lock.json`.
- Existing instruction sources: `.github/copilot-instructions.md` (validation rules), `COPILOT_SETUP.md` (manual test procedures), `TROUBLESHOOTING.md`, `MIGRATION.md`, `opencode/README.md`.

## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical role names as status strings. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout, with relevant scoped context documents also honored. See `docs/agents/domain.md`.
