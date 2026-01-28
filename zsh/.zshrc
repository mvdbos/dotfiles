# ----------------------------------------------------------------------------
# Oh My Zsh Configuration
# ----------------------------------------------------------------------------
export ZSH="$HOME/.oh-my-zsh"

# Theme
ZSH_THEME="dracula"

# Dracula theme customization - show last 3 directories
DRACULA_DISPLAY_FULL_CWD=0  # We'll override the directory function

# Update behavior
zstyle ':omz:update' mode reminder

# Performance optimizations
ZSH_DISABLE_COMPFIX=true

# Plugins (keep minimal for speed)
# Note: zsh-syntax-highlighting MUST be last
plugins=(
  git
  docker
  zsh-autosuggestions
  zsh-syntax-highlighting
)

source $ZSH/oh-my-zsh.sh

# Override Dracula's directory function to show last 3 dirs with '...' prefix if truncated
# %(4~|.../|) = if path has 4+ components, show '.../', otherwise nothing
# %3~ = show last 3 directory components
dracula_directory() {
	print -P '%(4~|.../|)%3~ '
}

# ----------------------------------------------------------------------------
# History Configuration
# ----------------------------------------------------------------------------
HISTSIZE=10000
SAVEHIST=10000
HISTFILE=~/.zsh_history

setopt EXTENDED_HISTORY          # Record timestamp of command
setopt HIST_EXPIRE_DUPS_FIRST    # Delete duplicates first when HISTFILE size exceeds HISTSIZE
setopt HIST_IGNORE_DUPS          # Don't record an entry that was just recorded again
setopt HIST_IGNORE_SPACE         # Don't record an entry starting with a space
setopt HIST_VERIFY               # Don't execute immediately upon history expansion
setopt SHARE_HISTORY             # Share history between all sessions
setopt INC_APPEND_HISTORY        # Write to history file immediately

# ----------------------------------------------------------------------------
# Completion Configuration
# ----------------------------------------------------------------------------
# Enable completion for `g` (like `g co`, `g ci`, etc.)
compdef g=git
# Show git aliases (co, ci, bl, etc.) in completion, not just common commands
zstyle ':completion:*:*:git:*' tag-order 'common-commands alias-commands'

# ----------------------------------------------------------------------------
# Directory Navigation
# ----------------------------------------------------------------------------
setopt AUTO_CD               # Change directory without typing cd
setopt AUTO_PUSHD            # Push directories onto stack automatically
setopt PUSHD_IGNORE_DUPS     # Don't push duplicates
setopt PUSHD_MINUS           # Swap meaning of +/- in directory stack

# ----------------------------------------------------------------------------
# Vi Mode Configuration
# ----------------------------------------------------------------------------
bindkey -v                   # Enable vi mode
export KEYTIMEOUT=1          # Reduce delay when switching modes

# Vi mode indicator function
function zle-keymap-select {
  if [[ ${KEYMAP} == vicmd ]] || [[ $1 = 'block' ]]; then
    echo -ne '\e[1 q'  # Block cursor for normal mode
  else
    echo -ne '\e[5 q'  # Beam cursor for insert mode
  fi
}

function zle-line-init {
  echo -ne "\e[5 q"    # Beam cursor on init
}

function zle-line-finish {
  echo -ne '\e[1 q'    # Reset to block cursor before command execution
}

zle -N zle-keymap-select
zle -N zle-line-init
zle -N zle-line-finish

# Better vi mode bindings
# bindkey '^P' up-history
# bindkey '^N' down-history
# bindkey '^?' backward-delete-char
# bindkey '^h' backward-delete-char
# bindkey '^w' backward-kill-word
# bindkey '^r' history-incremental-search-backward

# ----------------------------------------------------------------------------
# Prompt Configuration
# ----------------------------------------------------------------------------
# Add time to right prompt (Dracula theme customization)
DRACULA_DISPLAY_TIME=0
DRACULA_TIME_FORMAT="%H:%M"
RPROMPT='%F{240}[%D{%H:%M}]%f'

# ----------------------------------------------------------------------------
# Correction
# ----------------------------------------------------------------------------
ENABLE_CORRECTION="true"

# ----------------------------------------------------------------------------
# Aliases & Functions
# ----------------------------------------------------------------------------
# Disable Oh My Zsh aliases that conflict with custom commands
unalias gbm 2>/dev/null
unalias gcm 2>/dev/null

# Source shared aliases
if [ -f "$HOME/.config/shell/aliases" ]; then
    source "$HOME/.config/shell/aliases"
fi

# Source shared functions
if [ -f "$HOME/.config/shell/functions" ]; then
    source "$HOME/.config/shell/functions"
fi

# Alias cd to use cdbm function
alias cd='cdbm'

# ----------------------------------------------------------------------------
# External Configurations
# ----------------------------------------------------------------------------
# Note: Environment variables are in .zshenv (sourced for all zsh shells)
# .profile is preserved for bash compatibility only

# ----------------------------------------------------------------------------
# Plugin Configurations
# ----------------------------------------------------------------------------
# zsh-autosuggestions: Use history only for speed (not completion)
ZSH_AUTOSUGGEST_STRATEGY=(history)
ZSH_AUTOSUGGEST_BUFFER_MAX_SIZE=20

# ----------------------------------------------------------------------------
# Performance: Return true to avoid bad exit status on prompt
# ----------------------------------------------------------------------------
true

# ----------------------------------------------------------------------------
# Performance Profiling (uncomment to see startup time breakdown)
# ----------------------------------------------------------------------------
# zprof
