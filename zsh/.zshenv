# ~/.zshenv: sourced for ALL zsh invocations (login, interactive, scripts)
# Use this for environment variables that should be available everywhere

# Platform detection (cached for speed, instead of running detect_platform)
export PLATFORM_NAME="Darwin"
export PLATFORM_IS_DARWIN=1
export PLATFORM_IS_LINUX=0
export PLATFORM_IS_UBUNTU=0
export PLATFORM_IS_ANDROID=0
export PLATFORM_IS_RASPBERRY=0

# Path to your dotfiles (if needed)
# export DOTFILES="$HOME/.dotfiles"

# Homebrew environment (cached instead of calling 'brew shellenv' every time)
# This saves ~750ms on startup. Update manually if brew location changes.
export HOMEBREW_PREFIX="/usr/local"
export HOMEBREW_CELLAR="/usr/local/Cellar"
export HOMEBREW_REPOSITORY="/usr/local/Homebrew"
export PATH="/usr/local/bin:/usr/local/sbin${PATH+:$PATH}"
export MANPATH="/usr/local/share/man${MANPATH+:$MANPATH}:"
export INFOPATH="/usr/local/share/info:${INFOPATH:-}"

# Additional PATH entries
PATH="$HOME/.bin:$PATH"
PATH="/opt/homebrew/bin:$PATH"

# Make the GNU coreutils preferred over the BSD ones on macOS
if [ -n "$HOMEBREW_PREFIX" ]; then
    PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
fi

# Set PATH to include user's private bin directories
if [ -d "$HOME/bin" ]; then
    PATH="$HOME/bin:$PATH"
fi

if [ -d "$HOME/.local/bin" ]; then
    PATH="$HOME/.local/bin:$PATH"
fi

export PATH

# Skip duplicate path entries
typeset -U path

# Common environment variables
export EDITOR="vim"
export VISUAL="vim"
export SVN_EDITOR="vim"

# Platform-specific environment variables
if [ "$PLATFORM_IS_DARWIN" -eq 1 ] 2>/dev/null; then
    export LC_ALL=en_US.UTF-8
    export LANG=en_US.UTF-8
elif [ "$PLATFORM_IS_UBUNTU" -eq 1 ] 2>/dev/null; then
    export LC_ALL=en_US.utf8
    export LANGUAGE=en_US.utf8
    export LANG=en_US.utf8
fi

# Performance: Skip global compinit in /etc/zshrc on macOS
skip_global_compinit=1

