# OpenCode Configuration

This package contains the global OpenCode harness: configuration, commands, plugins, and workflow skills.

## Contents

- `opencode.json` - OpenCode permissions and settings
- `package.json` - OpenCode plugin dependencies (@opencode-ai/plugin)
- `.config/opencode/skills/` - 19 locally maintained workflow skills, installed globally by Stow
- `.config/opencode/references/` - Shared skill references (including `grilling.md`)
- `.config/opencode/command/afk.md` - Autonomous implementation command

`hf-cli` is installed independently under `~/.agents/skills/` and is not a harness dependency. The suite was migrated from `mvdbos/dotagents` at commit `4955cfc`, with the previously uncommitted triage changes preserved and its grilling pointer repaired during import. Most skills derive from `mattpocock/skills`; `audit-opencode-session` was authored locally. See [the ownership decision](../docs/adr/0001-opencode-owns-workflow-skills.md).

## Configuration Highlights

### External Directory Permissions

**Default Behavior:** Ask before accessing files outside project directory

**Always Allowed (no prompt):**
- `/tmp/**` - Temporary directories
- `/private/tmp/**` - macOS temporary directories
- `~/.config/**` - Configuration files
- `~/.dotfiles/**` - Dotfiles repository

This sandboxes OpenCode to the current project directory by default, while allowing access to common safe locations.

### Git Protection

**Requires approval for destructive operations:**
- `git push*` - All push variants (including force push)
- `git push --force*` / `git push -f*` - Force push
- `git push --force-with-lease*` - Safer force push
- `git push --delete*` - Delete remote branches
- `git reset --hard*` - Hard reset (loses uncommitted work)
- `git rebase*` - Rebase operations
- `git filter-branch*` - Repository history rewriting

**Still allowed without prompting:**
- `git commit` - Regular commits
- `git pull` / `git fetch` - Fetching changes
- `git status` / `git log` / `git diff` - Read operations
- Other non-destructive git commands

### Shell Compatibility

Works with all shells (bash, zsh, fish, etc.) - command interception happens before shell execution.

## Post-Stow Setup

After stowing this package on a new machine, install dependencies:

```bash
cd ~/.config/opencode
bun install  # or npm install
```

This installs the `@opencode-ai/plugin` package required for OpenCode functionality.

## Maintenance

### Modifying Permissions

Edit `opencode.json` to change permission settings. Changes take effect immediately (may need to restart OpenCode).

### Adding Skills

Add a complete skill directory under `.config/opencode/skills/`, with a `SKILL.md` and its support files. Put shared, non-discoverable references under `.config/opencode/references/`; update callers and run `bun test ./skills/closure.test.js` from `.config/opencode/` to check Stow installation and dependency closure.

### Updating Dependencies

```bash
cd ~/.config/opencode
bun update @opencode-ai/plugin
# or
npm update @opencode-ai/plugin
```

## Files Excluded from Version Control

The following files are generated locally and excluded via `.gitignore`:
- `node_modules/` - Installed dependencies
- `bun.lock` / `package-lock.json` / `yarn.lock` - Lock files

These will be regenerated when you run `bun install` or `npm install`.

## Usage

Once stowed and dependencies are installed, OpenCode will automatically use this configuration when launched from any directory.

### Permission Prompts

When a protected operation is triggered, you'll see a prompt with options:
- **once** - Approve just this request
- **always** - Approve for the rest of the session
- **reject** - Deny the request

### Skills

Skills are loaded automatically by OpenCode. Use them in your prompts or let OpenCode invoke them when appropriate.
