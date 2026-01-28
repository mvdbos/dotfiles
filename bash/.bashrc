# Mark that .bashrc has been sourced to prevent circular sourcing with .profile
export BASHRC_SOURCED=1

# Source shared profile for PATH and environment setup
# This is needed for interactive non-login shells
if [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
fi

# If not running interactively, don't do anything
case $- in
    *i*) ;;
    *) return;;
esac


# append to the history file, don't overwrite it
shopt -s histappend

# don't put duplicate lines or lines starting with space in the history.
# See bash(1) for more options
HISTCONTROL=ignorespace:ignoredups:erasedups
#
# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=100000
HISTFILESIZE=100000

export HISTTIMEFORMAT="%F %T "          ## Adds time to history
export HISTIGNORE='history:ls:l:la:ll:gs::gd:gfp:fg:bg:man[ ]*:pwd:cd:which*:ps'    ## colon-separated list of commands to ignore. Exact match

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# Add autocorrect to dirnames
shopt -s cdspell
shopt -s dirspell
shopt -u direxpand

# If set, Bash lists the status of any stopped and running jobs before exiting an
# interactive shell. If any jobs are running, this causes the exit to be deferred
# until a second exit is attempted without an intervening command.
# The shell always postpones exiting if any jobs are stopped.
shopt -s checkjobs

# Enable recursion with **, e.g. for f in **; do echo "$f";done
shopt -s globstar

# If set, Bash includes filenames beginning with a ‘.’ in the results of filename expansion.
# The filenames ‘.’ and ‘..’ must always be matched explicitly, even if dotglob is set.
shopt -s dotglob

# make less more friendly for non-text input files, see lesspipe(1)
[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# Source shared aliases
if [ -f "$HOME/.config/shell/aliases" ]; then
    source "$HOME/.config/shell/aliases"
fi

# Source shared functions
if [ -f "$HOME/.config/shell/functions" ]; then
    source "$HOME/.config/shell/functions"
fi

# Set up cd alias and shortcuts
alias cd='cdbm'
alias ..='up 1'
alias ...='up 2'
alias ....='up 3'

# Bash-specific git aliases (moved from shared shell config)
# These are kept bash-specific to allow zsh to use oh-my-zsh git plugin
# Note: Some aliases use git config shortcuts (ci, co, st, lg, bl, brem, gbm, gr)
# Add these to ~/.gitconfig: [alias] ci = commit, co = checkout, st = status, etc.
alias g='git'
alias ga='g add'
alias gap='g add -p'
alias gbl='g bl | grep -v year | grep -v month'          # Uses git bl alias
alias gbr='g brem | grep -v year | grep -v month'        # Uses git brem alias
alias gb='gbm'                                            # Uses git gbm alias
alias gc='g ci'                                           # Uses git ci alias
alias gco='g co'                                          # Uses git co alias
alias gd='clear && g diff'
alias gdm='g diff origin/master'
alias gf='g fetch --all'
alias gfp='g fetch && g pull --recurse-submodules && g delete-merged-branches && git-delete-squashed-branches'
alias gg='g gr'                                           # Uses git gr alias
alias gl='g lg'                                           # Uses git lg alias
alias glm='g lg origin/master..'
alias glc='g log -1 -u'
alias gp='g push'
alias gr='g rebase'
alias gs='g st'                                           # Uses git st alias
alias gw="g log --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %C(white)%s %Cgreen(%cr)%Creset %C(blue)(%an)%Creset %n%+b' --stat --no-merges  --date=relative --ignore-all-space --ignore-blank-lines  --ignore-space-at-eol  --ignore-space-change"
alias gwip="git add . && git commit -m 'WIP' --no-verify  && git push"
alias git-delete-local-orphan-branches="git branch -vv | awk '\$1 != \"*\"' | awk '\$4 ~ /gone\]/ || \$3 !~ /\[origin\// {print \$1}' | xargs -p -n 1 git branch -D"
alias gdom="gd origin/master"

# Set bash to use vi as readline for the command line.
# Note: this is also done by the settings in .inputrc already. This is extra
set -o vi

# Note: Locale variables (LC_*, LANG) should be set at system/session level,
# not in shell RC files. Re-exporting them here can cause warnings if the
# locale values are invalid or not installed. Let the environment handle it.

# load source files
if [ "$PLATFORM_IS_DARWIN" -eq 1 ] 2>/dev/null; then
    test -f /usr/local/etc/bash_completion.d/git-prompt.sh && source /usr/local/etc/bash_completion.d/git-prompt.sh

    # We don't need hub autocompletion set up on macOS: Homebrew does that for us
    if type brew &>/dev/null; then
        HOMEBREW_PREFIX="$(brew --prefix)"
        if [[ -r "${HOMEBREW_PREFIX}/etc/profile.d/bash_completion.sh" ]]; then
            source "${HOMEBREW_PREFIX}/etc/profile.d/bash_completion.sh"
        else
            for COMPLETION in "${HOMEBREW_PREFIX}/etc/bash_completion.d/"*; do
                [[ -r "$COMPLETION" ]] && source "$COMPLETION"
            done
        fi
    fi
elif [ "$PLATFORM_IS_UBUNTU" -eq 1 ] 2>/dev/null; then
    test -f /etc/bash_completion.d/git-prompt && source /etc/bash_completion.d/git-prompt
    test -f /usr/share/bash-completion/bash_completion && source /usr/share/bash-completion/bash_completion
    test -f /usr/share/bash-completion/completions/git && source /usr/share/bash-completion/completions/git
elif [ "$PLATFORM_IS_RASPBERRY" -eq 1 ] 2>/dev/null; then
    test -f /etc/bash_completion.d/git-prompt && source /etc/bash_completion.d/git-prompt
    test -f /usr/share/bash-completion/bash_completion && source /usr/share/bash-completion/bash_completion
    test -f /usr/share/bash-completion/completions/git && source /usr/share/bash-completion/completions/git
elif [ "$PLATFORM_IS_ANDROID" -eq 1 ] 2>/dev/null; then
    test -f $PREFIX/etc/bash_completion.d/git-prompt && source $PREFIX/etc/bash_completion.d/git-prompt
    test -f $PREFIX/usr/share/bash-completion/bash_completion && source $PREFIX/usr/share/bash-completion/bash_completion
    test -f $PREFIX/usr/share/bash-completion/completions/git && source $PREFIX/usr/share/bash-completion/completions/git
fi

BLUE="\[\$(tput setaf 4)\]"
CYAN="\[\$(tput setaf 6)\]"
GREEN="\[\$(tput setaf 2)\]"
GREY="\[\$(tput setaf 8)\]"
MAGENTA="\[\$(tput setaf 5)\]"
RED="\[\$(tput setaf 1)\]"
WHITE="\[\$(tput setaf 7)\]"
YELLOW="\[\$(tput setaf 3)\]"

BLINK="\[\$(tput blink)\]"
BOLD="\[\$(tput bold)\]"
ITALIC="\[\$(tput sitm)\]"
UNDERLINE="\[\$(tput smul)\]"

RESET="\[\$(tput sgr0)\]"

function prompt_info() {
    local prompt_string=""

    # Check Jobs
    type jobs &>/dev/null
    if [ $? == "0" ]; then
        local jobs=$(jobs | awk 'NR > 1 {printf ", "}{printf "%s",$3} END {print ""}')
        if [ -n "$jobs" ]; then
            prompt_string+="${YELLOW}${BOLD}(jobs: ${jobs})${RESET} "
        fi
    fi

    # Only show hostname if not on localhost
    if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_TTY" ]; then
        prompt_string+="${MAGENTA}\h${RESET}:"
    fi

    prompt_string+="[${BLUE}${BOLD}\w${RESET}]"

    echo -n $prompt_string
}

# Set the truncation length of \w (current working dir) in prompt
export PROMPT_DIRTRIM=3

# Git prompt settings
export GIT_PS1_SHOWDIRTYSTATE=true
export GIT_PS1_SHOWUNTRACKEDFILES=true
export GIT_PS1_SHOWUPSTREAM=auto
export GIT_PS1_SHOWCOLORHINTS=true


PS0="\n"

function record_command_details() {
    previous_command=$BASH_COMMAND
}

# Run before each interactive command is executed
start_command_timer() {
    if [ "UNSET" == "${timer}" ]; then
        timer=$SECONDS
    else
        timer=${timer:-$SECONDS}
    fi
}

# Run before the prompt is displayed
stop_command_timer() {
    if [ "UNSET" == "${timer}" ]; then
        the_seconds=0
        timer_show="0s"
    else
        the_seconds=$((SECONDS - timer))
        timer_show="$(format-duration seconds $the_seconds)"
    fi
    timer="UNSET"
}

preexec_functions+=(start_command_timer)
precmd_functions+=(stop_command_timer)
preexec_functions+=(record_command_details)

function __prompt_command() {
    local exit_code="$?"

    LONG_RUNTIME=60
    if [ -n "$the_seconds" ] && [ $the_seconds -gt $LONG_RUNTIME ]; then
        TIMER_RESULT="\n${YELLOW}${BOLD}(runtime: ~${timer_show})${RESET} "
    else
        TIMER_RESULT=""
    fi

    if [ $exit_code != 0 ]; then
        EXIT_STATUS="\n${RED}(exit: ${exit_code}, cmd: \\\`${previous_command}\\\`)${RESET} "
    else
        EXIT_STATUS=""
    fi

    PS_LINE=`printf -- '- %.0s' {1..200}`
    PS_FILL="${GREY}\${PS_LINE:0:$COLUMNS}${RESET}\[\033[0G\]"

    PS_GIT='$(__git_ps1 " (%s)")'
    PS_TIME="\[\033[\$((COLUMNS-7))G\] ${GREY}[$(date +%H:%M)]${RESET}"
    PS_PROMPT="\\n${GREY}\\\$${RESET} "

    PS1="${TIMER_RESULT}${EXIT_STATUS}\n${PS_FILL}$(prompt_info)${PS_GIT}${PS_TIME}${RESET}${PS_PROMPT}"
}

PROMPT_COMMAND=__prompt_command;

# enable git completion on 'g' alias in addition to 'git'
__git_complete g __git_main
__git_complete ga _git_add
__git_complete gap _git_add
__git_complete gb _git_branch
__git_complete gc _git_commit
__git_complete gco _git_checkout
__git_complete gd _git_diff
__git_complete gdo _git_diff
__git_complete gf _git_fetch
__git_complete gg _git_grep
__git_complete gl _git_log
__git_complete glc _git_log
__git_complete gp _git_push
__git_complete gr _git_rebase
__git_complete gs _git_status
__git_complete gw _git_log

[[ -f ~/.bash-preexec.sh ]] && source ~/.bash-preexec.sh

test -f ~/.bashrc.local && source ~/.bashrc.local

# Make this the last return value,
# so we don't have an exit status of the test command on our prompt
true
