# Zsh configuration file
# This is sourced for interactive shells

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# Source shared profile for common environment setup
if [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
fi

# History configuration
HISTFILE=~/.zsh_history
HISTSIZE=100000
SAVEHIST=100000

# History options (zsh native - much simpler than bash)
setopt APPEND_HISTORY           # Append to history file
setopt EXTENDED_HISTORY         # Write the history file in the :start:elapsed;command format
setopt HIST_EXPIRE_DUPS_FIRST   # Expire duplicate entries first when trimming history
setopt HIST_FIND_NO_DUPS        # Do not display a line previously found
setopt HIST_IGNORE_ALL_DUPS     # Delete old recorded entry if new entry is a duplicate
setopt HIST_IGNORE_DUPS         # Don't record an entry that was just recorded again
setopt HIST_IGNORE_SPACE        # Don't record an entry starting with a space
setopt HIST_REDUCE_BLANKS       # Remove superfluous blanks before recording entry
setopt HIST_SAVE_NO_DUPS        # Don't write duplicate entries in the history file
setopt HIST_VERIFY              # Don't execute immediately upon history expansion
setopt INC_APPEND_HISTORY       # Write to the history file immediately, not when the shell exits
setopt SHARE_HISTORY            # Share history between all sessions

# Ignore these commands in history
HISTORY_IGNORE='(history|ls|l|la|ll|gs|gd|gfp|fg|bg|man *|pwd|cd|which*|ps)'

# Shell options
setopt AUTO_CD              # If a command is a directory name, cd to it
setopt AUTO_PUSHD           # Make cd push the old directory onto the directory stack
setopt PUSHD_IGNORE_DUPS    # Don't push multiple copies of the same directory
setopt PUSHD_MINUS          # Exchange the meanings of '+' and '-' in pushd
setopt CDABLE_VARS          # If argument to cd is not a directory, try to expand it as a variable
setopt CORRECT              # Spelling correction for commands
setopt EXTENDED_GLOB        # Use extended globbing syntax
setopt GLOB_DOTS            # Include dotfiles in glob matches (like bash's dotglob)
setopt NO_BEEP              # Don't beep on errors
setopt MULTIOS              # Perform implicit tees or cats when multiple redirections are attempted
setopt PROMPT_SUBST         # Enable parameter expansion, command substitution, and arithmetic expansion in prompts
setopt INTERACTIVE_COMMENTS # Allow comments in interactive shells

# Job control
setopt CHECK_JOBS           # Report the status of background jobs immediately
setopt NOTIFY               # Report the status of background jobs immediately
setopt NO_HUP               # Don't send HUP signal to jobs when shell exits

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# make less more friendly for non-text input files, see lesspipe(1)
[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

# Source shared aliases
if [ -f "$HOME/.config/shell/aliases" ]; then
    source "$HOME/.config/shell/aliases"
fi

# Source shared functions
if [ -f "$HOME/.config/shell/functions" ]; then
    source "$HOME/.config/shell/functions"
fi

# Set up cd alias to use the bookmark function
alias cd='cdbm'
alias ..='up 1'
alias ...='up 2'
alias ....='up 3'

# Load locale
eval $(locale) 2>/dev/null

# Vi mode configuration
bindkey -v  # Enable vi mode
export KEYTIMEOUT=1  # Reduce delay when switching modes

# Better vi mode with visual indicators and history search
bindkey -M viins '^?' backward-delete-char  # Backspace
bindkey -M viins '^H' backward-delete-char  # Ctrl-H
bindkey -M viins '^W' backward-kill-word    # Ctrl-W
bindkey -M viins '^U' backward-kill-line    # Ctrl-U
bindkey -M viins '^A' beginning-of-line     # Ctrl-A
bindkey -M viins '^E' end-of-line           # Ctrl-E
bindkey -M viins '^K' kill-line             # Ctrl-K
bindkey -M viins '^L' clear-screen          # Ctrl-L
bindkey -M viins '^R' history-incremental-search-backward  # Ctrl-R

# History search with arrow keys in vi mode
bindkey -M viins '^[[A' history-search-backward  # Up arrow
bindkey -M viins '^[[B' history-search-forward   # Down arrow
bindkey -M vicmd 'k' history-search-backward
bindkey -M vicmd 'j' history-search-forward

# Alt-. to insert last argument (like bash)
bindkey -M viins '\e.' insert-last-word

# Initialize completion system
autoload -Uz compinit
compinit

# Completion options
setopt ALWAYS_TO_END        # Move cursor to the end of a completed word
setopt AUTO_MENU            # Show completion menu on successive tab press
setopt AUTO_LIST            # Automatically list choices on ambiguous completion
setopt COMPLETE_IN_WORD     # Complete from both ends of a word
unsetopt MENU_COMPLETE      # Do not autoselect the first completion entry

# Completion styling
zstyle ':completion:*' menu select  # Enable menu selection
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'  # Case-insensitive completion
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"    # Use LS_COLORS for file completion
zstyle ':completion:*' completer _complete _match _approximate
zstyle ':completion:*:match:*' original only
zstyle ':completion:*:approximate:*' max-errors 1 numeric
zstyle ':completion:*' group-name ''
zstyle ':completion:*:descriptions' format '%B%d%b'
zstyle ':completion:*:messages' format '%d'
zstyle ':completion:*:warnings' format 'No matches for: %d'
zstyle ':completion:*:corrections' format '%B%d (errors: %e)%b'

# Git completion (zsh has built-in git completion)
# Just need to enable it, which compinit does

# Load platform-specific completions and configs
if [[ $PLATFORM_IS_DARWIN -eq 1 ]] 2>/dev/null; then
    # On macOS with Homebrew
    if type brew &>/dev/null; then
        FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"
        autoload -Uz compinit
        compinit
    fi
elif [[ $PLATFORM_IS_UBUNTU -eq 1 ]] 2>/dev/null || [[ $PLATFORM_IS_RASPBERRY -eq 1 ]] 2>/dev/null; then
    # On Ubuntu/Raspberry Pi
    if [ -d /usr/share/zsh/vendor-completions ]; then
        fpath=(/usr/share/zsh/vendor-completions $fpath)
    fi
elif [[ $PLATFORM_IS_ANDROID -eq 1 ]] 2>/dev/null; then
    # On Android/Termux
    if [ -d "$PREFIX/share/zsh/site-functions" ]; then
        fpath=("$PREFIX/share/zsh/site-functions" $fpath)
    fi
fi

# Define colors for prompt
autoload -U colors && colors

# Timer and command tracking for prompt
typeset -g __command_start_time
typeset -g __previous_command
typeset -g __command_duration

# Preexec hook - runs before each command
preexec() {
    __command_start_time=$SECONDS
    __previous_command="$1"
}

# Precmd hook - runs before each prompt
precmd() {
    local exit_code=$?
    
    # Calculate command duration
    if [ -n "$__command_start_time" ]; then
        __command_duration=$((SECONDS - __command_start_time))
    else
        __command_duration=0
    fi
    unset __command_start_time
    
    # Format duration using our shared script
    local timer_show
    if [ $__command_duration -gt 0 ]; then
        timer_show=$(format-duration seconds $__command_duration)
    else
        timer_show="0s"
    fi
    
    # Build prompt components
    local timer_result=""
    local exit_status=""
    local long_runtime=60
    
    if [ $__command_duration -gt $long_runtime ]; then
        timer_result=$'\n'"%F{yellow}%B(runtime: ~${timer_show})%b%f "
    fi
    
    if [ $exit_code -ne 0 ]; then
        exit_status=$'\n'"%F{red}(exit: ${exit_code}, cmd: \`${__previous_command}\`)%f "
    fi
    
    # Build the prompt
    local ps_fill="%F{8}${(l:$COLUMNS::-:)}%f"
    local ps_git='$(git_prompt_info)'
    local ps_time="%F{8}[%*]%f"
    
    # Info section (with SSH hostname if applicable)
    local prompt_info=""
    
    # Check for background jobs
    local jobs_info=$(jobs | wc -l | tr -d ' ')
    if [ "$jobs_info" -gt 0 ]; then
        prompt_info+="%F{yellow}%B(jobs: $jobs_info)%b%f "
    fi
    
    # Show hostname if SSH
    if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_TTY" ]; then
        prompt_info+="%F{magenta}%m%f:"
    fi
    
    # Add directory (truncated to 3 levels)
    prompt_info+="[%F{blue}%B%3~%b%f]"
    
    # Set the full prompt
    PROMPT="${timer_result}${exit_status}"$'\n'"${ps_fill}"$'\r'"${prompt_info}${ps_git} ${ps_time}"$'\n'"%F{8}$%f "
}

# Git prompt info function (simpler version)
git_prompt_info() {
    local ref
    ref=$(git symbolic-ref HEAD 2> /dev/null) || ref=$(git rev-parse --short HEAD 2> /dev/null) || return 0
    local branch="${ref#refs/heads/}"
    
    # Check for changes
    local status_flags=""
    if ! git diff --quiet 2>/dev/null; then
        status_flags+="*"
    fi
    if ! git diff --cached --quiet 2>/dev/null; then
        status_flags+="+"
    fi
    if [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
        status_flags+="%"
    fi
    
    if [ -n "$status_flags" ]; then
        echo " %F{red}(${branch} ${status_flags})%f"
    else
        echo " %F{green}(${branch})%f"
    fi
}

# Source local zshrc overrides if they exist
[ -f ~/.zshrc.local ] && source ~/.zshrc.local

# Make this the last return value,
# so we don't have an exit status from the test command on our prompt
true
