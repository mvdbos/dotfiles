# OpenCode Configuration

This package contains OpenCode configuration and custom skills.

## Contents

- `opencode.json` - OpenCode permissions and settings
- `package.json` - OpenCode plugin dependencies (@opencode-ai/plugin)
- `skills/` - Custom OpenCode skills
  - `commit/` - Guides proper git commit formatting with user approval
  - `skill-creator/` - Guide for creating new OpenCode skills

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

Add new skill directories to `skills/`. Each skill should have:
- `SKILL.md` - Main skill definition
- `LICENSE.txt` - License information
- Optional: `references/` and `scripts/` directories

Refer to the `skill-creator` skill for guidance on creating new skills.

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
