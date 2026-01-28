# ~/.profile: executed by the command interpreter for login shells.
# This file should be POSIX-compatible and work with both bash and zsh.

# Set PATH so it includes various bin directories
PATH="/usr/local/bin:/usr/local/sbin:$PATH"
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

# Source platform detector
if [ -f "$HOME/.dotfiles/platform_detector.bash" ]; then
    . "$HOME/.dotfiles/platform_detector.bash"
fi

# Common environment variables
export EDITOR="vim"
export VISUAL="vim"
export SVN_EDITOR="vim"

export WGETRC="${HOME}/.config/wget/wgetrc"
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'
export BAT_THEME="Dracula"
export MANPAGER="sh -c 'col -bx | bat -l man -p'"

# Set CDPATH to allow quick cd to directory aliases
CDPATH=.:~/.config/dir_aliases:$CDPATH
export CDPATH

# Platform-specific environment variables
if [ "$PLATFORM_IS_DARWIN" -eq 1 ] 2>/dev/null; then
    export LC_ALL=en_US.UTF-8
    export LANG=en_US.UTF-8
    
    if command -v brew >/dev/null 2>&1; then
        eval "$(brew shellenv)"
        export HOMEBREW_CASK_OPTS="--appdir=${HOME}/Applications"
        export HOMEBREW_NO_ANALYTICS="true"
        export HOMEBREW_NO_ENV_HINTS="true"
    fi
elif [ "$PLATFORM_IS_UBUNTU" -eq 1 ] 2>/dev/null; then
    export LC_ALL=en_US.utf8
    export LANGUAGE=en_US.utf8
    export LANG=en_US.utf8
fi

# SDKMAN initialization
export SDKMAN_DIR="$HOME/.sdkman"
if [ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
    . "$HOME/.sdkman/bin/sdkman-init.sh"
fi

# Source local profile overrides if they exist
if [ -f "$HOME/.profile.local" ]; then
    . "$HOME/.profile.local"
fi

# For bash login shells, source .bashrc to get interactive configuration
# Only do this if .bashrc hasn't been sourced yet (to avoid circular sourcing)
if [ -n "$BASH_VERSION" ] && [ -z "$BASHRC_SOURCED" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi
