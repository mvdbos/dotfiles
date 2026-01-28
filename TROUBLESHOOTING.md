# Troubleshooting Guide

## Common Issues

### "command not found" errors for cdbm, gfp, or other aliases

**Symptoms:**
```bash
cd .dotfiles/
bash: cdbm: command not found
```
or
```bash
gfp
bash: gfp: command not found
```

**Cause:**
The shell configuration hasn't been loaded in your current session.

**Solution:**

1. **Ensure stow has been run** (from your `.dotfiles` directory):
   ```bash
   cd ~/.dotfiles
   stow shell
   stow bash  # or stow zsh for zsh
   ```

2. **Reload your shell configuration** by either:
   - Starting a new terminal session, OR
   - Running: `source ~/.bashrc` (or `source ~/.zshrc` for zsh)

3. **Verify the configuration loaded**:
   ```bash
   type cdbm  # Should show "cdbm is a function"
   alias gfp  # Should show the alias definition
   ```

### Verifying Installation

Check that the symlinks were created correctly:

```bash
ls -la ~/
```

You should see symlinks like:
- `.bashrc -> .dotfiles/bash/.bashrc` (or similar for your setup)
- `.profile -> .dotfiles/shell/.profile`
- `.config/shell/` directory containing `aliases` and `functions`

### Missing Git Commands

Some aliases reference custom git commands that need separate installation:

- `git delete-merged-branches` - Install git-extras or create custom git alias
- `git-delete-squashed-branches` - Custom script, needs separate installation

These are optional enhancements and won't prevent the shell from working.

## Shell Startup Order

Understanding how shell configuration works:

### Bash
- **Login shells**: Source `.profile` → `.bashrc`
- **Interactive non-login shells**: Source `.bashrc` → `.profile`
- `.bashrc` sources `~/.config/shell/aliases` and `~/.config/shell/functions`

### Zsh
- **Login shells**: Source `.zprofile` → `.zshrc`
- **Interactive non-login shells**: Source `.zshrc` only
- `.zshrc` sources `~/.config/shell/aliases` and `~/.config/shell/functions`

## Fresh Installation Steps

For a clean installation:

1. **Clone the repository**:
   ```bash
   cd ~
   git clone https://github.com/yourusername/dotfiles.git .dotfiles
   cd .dotfiles
   ```

2. **Run setup script** (installs everything):
   ```bash
   ./setup.sh
   ```

3. **Or manually stow packages**:
   ```bash
   stow shell   # Shared configuration
   stow bash    # Bash-specific (or 'stow zsh' for zsh)
   stow git     # Git configuration
   stow vim     # Vim configuration
   # etc.
   ```

4. **Start a new shell session** or source your rc file:
   ```bash
   source ~/.bashrc  # or source ~/.zshrc
   ```

## Still Having Issues?

If commands are still not found after following the steps above:

1. Check if `.bashrc` is being sourced:
   ```bash
   echo $BASHRC_SOURCED  # Should show "1" if sourced
   ```

2. Check if files exist:
   ```bash
   ls -la ~/.config/shell/
   # Should show: aliases  functions
   ```

3. Manually source the files to test:
   ```bash
   source ~/.config/shell/functions
   source ~/.config/shell/aliases
   type cdbm  # Now should work
   ```

4. Check for errors when sourcing:
   ```bash
   bash -x ~/.bashrc  # Shows detailed execution
   ```
