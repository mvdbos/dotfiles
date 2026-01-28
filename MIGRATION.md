# Migration from Bash-only to Bash + Zsh Support

This document explains the changes made to support both bash and zsh while maintaining a shared core configuration.

## Summary

The dotfiles have been refactored to support both bash and zsh efficiently:
- Created a new **shell** stow package with shared configuration (~70% of the config)
- Created a new **zsh** stow package with zsh-specific configuration
- Updated the **bash** stow to use shared files and keep only bash-specific features
- Both shells maintain feature parity while leveraging their respective strengths

## What Changed

### New Packages Created

1. **shell/** - Shared shell configuration
   - `.profile` - Environment variables, PATH setup
   - `.config/shell/aliases` - All common aliases
   - `.config/shell/functions` - Common functions (up, cdbm)
   - `.dircolors` - LS_COLORS configuration
   - `.bin/` - Utility scripts
   - `.config/dir_aliases/` - Directory bookmarks

2. **zsh/** - Zsh-specific configuration
   - `.zshrc` - Zsh interactive shell config
   - `.zprofile` - Zsh login shell config

### Modified Packages

1. **bash/** - Reduced to bash-specific features only
   - Removed: `.profile`, `.dircolors`, `.bin/`, `.config/`
   - Kept: `.bashrc`, `.inputrc`, `.bash-preexec.sh`
   - Modified: `.bashrc` now sources shared files

### Architectural Benefits

#### Shared Configuration (shell/)
- Single source of truth for aliases, functions, and environment
- Reduces duplication and maintenance burden
- Ensures consistency across both shells

#### Shell-Specific Configuration
**Bash (bash/)**
- Bash completion setup
- PROMPT_COMMAND-based prompt
- bash-preexec.sh for hooks
- Readline configuration (.inputrc)

**Zsh (zsh/)**
- Native preexec/precmd hooks (no external library needed)
- Powerful history options (built-in deduplication)
- Advanced completion system
- Extended globbing (built-in)

## Feature Comparison

| Feature | Bash Implementation | Zsh Implementation |
|---------|-------------------|-------------------|
| **History** | shopt + HISTCONTROL | setopt (12+ history options) |
| **Globbing** | shopt -s globstar | Built-in, always available |
| **Completion** | bash-completion | compinit (more powerful) |
| **Hooks** | bash-preexec.sh | Native preexec/precmd |
| **Vi Mode** | set -o vi + .inputrc | bindkey -v |
| **Prompt** | PROMPT_COMMAND | precmd function |

## Ported Features

All major bash features were successfully ported to zsh:

1. **History Management**
   - Bash: `HISTCONTROL=ignorespace:ignoredups:erasedups`
   - Zsh: `setopt HIST_IGNORE_DUPS HIST_IGNORE_SPACE` + more

2. **Directory Spelling Correction**
   - Bash: `shopt -s cdspell dirspell`
   - Zsh: `setopt CORRECT`

3. **Globstar (recursive globs)**
   - Bash: `shopt -s globstar` for `**`
   - Zsh: Built-in, always works

4. **Dotglob (include dotfiles)**
   - Bash: `shopt -s dotglob`
   - Zsh: `setopt GLOB_DOTS`

5. **Command Timer**
   - Bash: bash-preexec + PROMPT_COMMAND
   - Zsh: Native preexec/precmd

6. **Vi Mode**
   - Bash: `set -o vi` + `.inputrc` config
   - Zsh: `bindkey -v` + custom bindings

7. **Prompt**
   - Bash: `PROMPT_COMMAND=__prompt_command`
   - Zsh: `precmd() { ... }`

8. **Git Prompt**
   - Bash: `__git_ps1` from git-prompt.sh
   - Zsh: Custom `git_prompt_info` function

## Compatibility Notes

### Tested Platforms
- ✅ Linux (Ubuntu, Raspberry Pi, Android/Termux)
- ✅ macOS (with Homebrew)
- ✅ Both bash and zsh

### Platform-Specific Behavior
Both shells respect platform detection:
- macOS: Uses GNU coreutils (gls, grm, gmv, etc.)
- Linux: Uses native coreutils
- All: Loads appropriate completions

### POSIX Compliance
Shared shell scripts (functions, profile) use POSIX-compatible syntax:
- No bash-isms like `[[` or `=~`
- No `seq` command (not POSIX)
- Works with sh, bash, zsh

## Migration Path

For users migrating from bash to zsh:

1. **Install zsh**: `brew install zsh` or `apt install zsh`
2. **Change shell**: `chsh -s $(which zsh)`
3. **Log out and back in**: Start a new terminal session
4. **First login**: May see compinit security warning (safe to accept)

The zsh configuration is installed during setup.sh, so it's ready whenever you want to switch. All aliases, functions, and environment remain the same!

## Files Organization

```
dotfiles/
├── shell/              # Shared (70% of config)
│   ├── .profile
│   ├── .dircolors
│   ├── .bin/
│   └── .config/shell/
│       ├── aliases
│       └── functions
├── bash/               # Bash-specific (15%)
│   ├── .bashrc
│   ├── .inputrc
│   └── .bash-preexec.sh
└── zsh/                # Zsh-specific (15%)
    ├── .zshrc
    └── .zprofile
```

## Testing

All configurations have been tested:
- ✅ Bash syntax validation
- ✅ Zsh syntax validation
- ✅ Stow installation
- ✅ Alias sourcing
- ✅ Function sourcing
- ✅ Interactive shell startup

## Future Improvements

Potential enhancements:
- [ ] Add zsh plugins (zsh-syntax-highlighting, zsh-autosuggestions)
- [ ] Optimize zsh startup time with compile option
- [ ] Add more zsh-specific key bindings
- [ ] Consider using Oh-My-Zsh or Prezto (optional)

## Questions?

See the READMEs in each directory:
- `shell/README.md` - Shared configuration details
- `zsh/README.md` - Zsh-specific features and porting guide
- Main `README.md` - Installation and usage
