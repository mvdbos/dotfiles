# Zsh Configuration

Zsh-specific dotfiles and configuration.

## Files

- **`.zshrc`** - Interactive shell configuration
  - History configuration with zsh's powerful history options
  - Shell options (auto_cd, extended_glob, etc.)
  - Vi mode key bindings
  - Completion system setup
  - Prompt configuration with git integration
  - Sources shared aliases and functions from `shell/`
  
- **`.zprofile`** - Login shell configuration
  - Sources the shared `.profile`

## Features

### History Management

Zsh has superior history management built-in:
- Automatic deduplication
- History verification before execution
- Shared history across all sessions
- Ignore commands starting with space
- 100,000 commands stored

### Shell Options

Key zsh options enabled:
- `AUTO_CD` - Type directory name to cd into it
- `EXTENDED_GLOB` - Advanced pattern matching
- `GLOB_DOTS` - Include dotfiles in glob patterns
- `CORRECT` - Spelling correction for commands
- `INTERACTIVE_COMMENTS` - Allow comments in interactive shell

### Vi Mode

Full vi mode with improved key bindings:
- `bindkey -v` enables vi mode
- Arrow keys for history search
- Ctrl-R for incremental search
- Common emacs bindings in insert mode (Ctrl-A, Ctrl-E, Ctrl-W, etc.)

### Completion

Zsh's powerful completion system is configured with:
- Case-insensitive matching
- Menu selection
- Approximate completion (typo tolerance)
- Color-coded completions matching LS_COLORS

### Prompt

Custom prompt with:
- Command execution time (shown if > 60 seconds)
- Exit status on error
- Current directory (truncated to 3 levels)
- Git branch and status
- Background job indicators
- Hostname (when SSH'd)
- Timestamp

### Native Hooks

Zsh natively supports preexec and precmd hooks:
- `preexec()` - Runs before each command (starts timer)
- `precmd()` - Runs before each prompt (stops timer, builds prompt)

No need for bash-preexec.sh!

## Ported from Bash

The following bash features have been ported to zsh:

| Bash Feature | Zsh Equivalent | Notes |
|--------------|----------------|-------|
| `shopt -s histappend` | `setopt APPEND_HISTORY` | Built-in, better |
| `HISTCONTROL` | `setopt HIST_IGNORE_*` | More granular options |
| `shopt -s globstar` | Already built-in | `**` works by default |
| `shopt -s dotglob` | `setopt GLOB_DOTS` | Include dotfiles |
| `PROMPT_COMMAND` | `precmd()` function | Native support |
| bash-preexec.sh | `preexec()` function | Native support |
| `.inputrc` vi mode | `bindkey -v` | Native support |

## Differences from Bash

### What Zsh Does Better

- **History**: More powerful deduplication and search
- **Globbing**: Extended patterns, recursive globs by default
- **Completion**: More intelligent, context-aware
- **Prompt**: More flexible, built-in right-aligned prompts
- **Hooks**: Native preexec/precmd support

### Shell-Specific Files

Bash keeps:
- `.bashrc` - Bash-specific configuration
- `.inputrc` - Readline configuration (bash-specific)
- `.bash-preexec.sh` - Preexec/precmd emulation

Zsh uses:
- `.zshrc` - Zsh-specific configuration
- `.zprofile` - Login shell setup

### Shared Files

Both shells use the shared configuration in `shell/`:
- `.profile` - Environment variables
- `.config/shell/aliases` - All aliases
- `.config/shell/functions` - Shell functions
- `.bin/` - Utility scripts
- `.dircolors` - LS colors

## Customization

To add local customizations that shouldn't be committed:
1. Create `~/.zshrc.local`
2. Add your custom configuration
3. It will be automatically sourced at the end of `.zshrc`

## Platform Support

Darwin (macOS) only. This zsh configuration is specifically designed for macOS with Homebrew.
