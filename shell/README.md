# Shared Shell Configuration

This directory contains shell-agnostic configuration files that work with both bash and zsh.

## Files

- **`.profile`** - Login shell configuration
  - PATH setup
  - Environment variables (EDITOR, MANPAGER, etc.)
  - Platform detection and platform-specific environment setup
  - SDKMAN initialization
  
- **`.dircolors`** - Color definitions for `ls` command output
  - Defines colors for different file types
  - Works with GNU coreutils (gls on macOS)
  
- **`.config/shell/aliases`** - Common shell aliases
  - ls, grep, git aliases
  - Platform-specific aliases (uses GNU tools on macOS via homebrew)
  - All git shortcuts
  
- **`.config/shell/functions`** - Shell functions
  - `up()` - Navigate up multiple directory levels
  - `cdbm()` - cd with directory bookmarks and auto-ls
  
- **`.bin/`** - Custom utility scripts
  - `format-duration` - Format time durations for display
  - `f` - Quick file finder
  
- **`.config/dir_aliases/`** - Directory bookmark symlinks
  - Create symlinks here to directories you access frequently
  - The `cdbm` function will resolve these bookmarks

## Usage

These files are automatically sourced by both bash and zsh:
- `.profile` is sourced by login shells
- `.config/shell/aliases` and `.config/shell/functions` are sourced from `.bashrc` and `.zshrc`

## Platform Detection

The configuration uses `platform_detector.bash` (in the root .dotfiles directory) to detect the current platform:
- macOS (Darwin)
- Ubuntu
- Raspberry Pi OS
- Android (Termux)

Platform-specific behavior is handled using `PLATFORM_IS_*` variables.

## Adding New Shared Configuration

When adding new configuration that should work in both bash and zsh:
1. Use POSIX-compatible shell syntax when possible
2. Test in both bash and zsh
3. Avoid shell-specific features (use `setopt` for zsh-only, `shopt` for bash-only)
4. Add to the appropriate file:
   - Environment variables → `.profile`
   - Aliases → `.config/shell/aliases`
   - Functions → `.config/shell/functions`
   - Utilities → `.bin/`
