# ~/.zprofile: executed by zsh for login shells
# This file is sourced before .zshrc
#
# Note: Core environment variables (PATH, EDITOR, LANG, etc.) are in .zshenv
# This file contains interactive/login-shell-specific configurations

# Interactive tool configurations
export WGETRC="${HOME}/.config/wget/wgetrc"
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'
export BAT_THEME="Dracula"
export MANPAGER="sh -c 'col -bx | bat -l man -p'"

# Set CDPATH to allow quick cd to directory aliases
CDPATH=.:~/.config/dir_aliases:$CDPATH
export CDPATH

# Homebrew interactive options
export HOMEBREW_CASK_OPTS="--appdir=${HOME}/Applications"
export HOMEBREW_NO_ANALYTICS="true"
export HOMEBREW_NO_ENV_HINTS="true"
