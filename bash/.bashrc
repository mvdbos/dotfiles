PATH="/usr/local/bin:/usr/local/sbin:$PATH"
PATH="~/.bin:$PATH"
PATH="/opt/homebrew/bin:$PATH"
PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH" # this makes the GNU coreutils preferred over the BSD ones


source ~/.dotfiles/platform_detector.bash

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
shopt -s direxpand

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

# load platform-dependent aliases
if [[ $PLATFORM_IS_DARWIN -eq 1 ]]; then
    alias ls='gls -F1B --group-directories-first --color=auto'
    alias rm='grm -I'
    alias mv='gmv -iu --strip-trailing-slashes'
    alias df='gdf -h --total'
    alias dir='gdir'
    alias date='gdate'
else
    alias ls='ls -F1B --group-directories-first --color=auto'
    alias rm='rm -I'
    alias mv='mv -iu --strip-trailing-slashes'
    alias df='df -h --total'
fi

export WGETRC="${HOME}/.config/wget/wgetrc"
alias wget='wget --execute ca_certificate=~/.config/certs/insg3_b64.cer --hsts-file=~/.config/wget/wget-hsts-db'

# enable color support of ls
alias dir='dir --color=auto'
alias vdir='vdir --color=auto'
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

if [ "$PLATFORM_IS_DARWIN" -eq 1 ] && type brew &>/dev/null; then
    eval $(brew shellenv)
    export HOMEBREW_CASK_OPTS="--appdir=${HOME}/Applications"
    export HOMEBREW_NO_ANALYTICS="true"
    export HOMEBREW_NO_ENV_HINTS="true"
fi

if [ "$PLATFORM_IS_DARWIN" -eq 1 ] || [ "$PLATFORM_IS_UBUNTU" -eq 1 ] || [ "$PLATFORM_IS_RASPBERRY" -eq 1 ]; then
    eval "$(thefuck --alias)"
    eval "$(thefuck --alias ?)"
fi

# colored GCC warnings and errors
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

# we always want to use Vim
export EDITOR="vim"
export VISUAL="vim"
export SVN_EDITOR="vim"

# Set bash to use vi as readline for the command line.
# Note: this is also done by the settings in .inputrc already. This is extra
set -o vi

# Set bat as cat alias and a pager for the man command
alias cat='bat --style=snip'
export MANPAGER="sh -c 'col -bx | bat -l man -p'"
export BAT_THEME="Dracula"
#It might also be necessary to set MANROFFOPT="-c" if you experience formatting problems.

alias ag='ag --hidden'

alias j='jobs'
alias k1='kill %1'
alias k2='kill %2'
alias k3='kill %3'

alias top='htop'
alias cp='cp -i'
alias mkdir='mkdir -pv'
alias diff='colordiff'
alias du='du -hc'
alias tree='tree -F'
# Any symlink to a dir put in this dir will be completed first with the cd command from anyhwhere
CDPATH=.:~/.config/dir_aliases:$CDPATH

# cd replacement that checks for a directory alias. If it exists, it will cd to that directory with cd -P
# note that cd output is sent to /dev/null to avoid it echoing the directory it's changing to caused by setting CDPATH
function cdbm() {
    local target_dir="$1"
    local aliases_dir="$HOME/.config/dir_aliases"

    if [[ -z "$target_dir" ]] || [[ $1 == "-" ]] || [[ $1 == "--help" ]] || [[ $1 == "-L" ]]; then
        builtin cd "$@" >/dev/null && ls
        return $?
    fi

    if [[ -d "$aliases_dir/$target_dir" ]]; then
        builtin cd -P "$target_dir" >/dev/null && ls
    else
        builtin cd "$@" >/dev/null && ls
    fi
}

alias cd='cdbm'

function up() {
    local levels="$1"
    local path=""
    for ((i = 1; i <= levels; i++)); do
        path="../$path"
    done
    cd "$path"
}

alias ..='up 1'
alias ...='up 2'
alias ....='up 3'
alias l='ls'
alias lrt='ls -rt'
alias ll='ls -ohgBv --group-directories-first'
alias la='ls -lAhvG --group-directories-first'

# load source files
if [ "$PLATFORM_IS_DARWIN" -eq 1 ]; then
    test -f /usr/local/etc/bash_completion.d/git-prompt.sh && source /usr/local/etc/bash_completion.d/git-prompt.sh

    # We don't need hub autocompletion set up on OS X: HomeBrew does that for us
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
elif [ "$PLATFORM_IS_UBUNTU" -eq 1 ]; then
    test -f /etc/bash_completion.d/git-prompt && source /etc/bash_completion.d/git-prompt
    test -f /usr/share/bash-completion/bash_completion && source /usr/share/bash-completion/bash_completion
    test -f /usr/share/bash-completion/completions/git && source /usr/share/bash-completion/completions/git
elif [ "$PLATFORM_IS_RASPBERRY" -eq 1 ]; then
    test -f /etc/bash_completion.d/git-prompt && source /etc/bash_completion.d/git-prompt
    test -f /usr/share/bash-completion/bash_completion && source /usr/share/bash-completion/bash_completion
    test -f /usr/share/bash-completion/completions/git && source /usr/share/bash-completion/completions/git
elif [ "$PLATFORM_IS_ANDROID" -eq 1 ]; then
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
    # First, we fill the line with dashes, then we move the cursor to the beginning of the line and overwrite the line with the actual prompt.
    PS_FILL="${GREY}\${PS_LINE:0:$COLUMNS}${RESET}\[\033[0G\]"

    PS_GIT='$(__git_ps1 " (%s)")'
    # for the time, we move the cursor to 10 chars from the end of the line and print the time.
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
__git_complete gf _git_fetch
__git_complete gg _git_grep
__git_complete gl _git_log
__git_complete glc _git_log
__git_complete gp _git_push
__git_complete gr _git_rebase
__git_complete gs _git_status
__git_complete gw _git_log

alias g='git'
alias ga='g add'
alias gap='g add -p'
alias gbl='g bl | grep -v year | grep -v month'
alias gbr='g brem | grep -v year | grep -v month'
alias gb='gbm'
alias gc='g ci'
alias gco='g co'
alias gd='clear && g diff'
alias gdm='g diff origin/master'
alias gf='g fetch && g delete-merged-branches && git-delete-squashed-branches'
alias gfp='g fetch && g pull --recurse-submodules && g delete-merged-branches && git-delete-squashed-branches '
alias gg='g gr'
alias gl='g lg'
alias glm='g lg origin/master..'
alias glc='g log -1 -u'
alias gp='g push'
alias gr='g rebase'
alias gs='g st'
alias gw="g log --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %C(white)%s %Cgreen(%cr)%Creset %C(blue)(%an)%Creset %n%+b' --stat --no-merges  --date=relative --ignore-all-space --ignore-blank-lines  --ignore-space-at-eol  --ignore-space-change"
alias gwip="git add . && git commit -m 'WIP' --no-verify  && git push"
alias git-delete-local-orphan-branches="git branch -vv | awk '\$1 != \"*\"' | awk '\$4 ~ /gone\]/ || \$3 !~ /\[origin\// {print \$1}' | xargs -p -n 1 git branch -D"
alias gdom="gd origin/master"


if [[ $PLATFORM_IS_DARWIN -eq 1 ]]; then
    export LC_ALL=en_US.UTF-8
    export LANG=en_US.UTF-8
elif [[ $PLATFORM_IS_UBUNTU -eq 1 ]]; then
    export LC_ALL=en_US.utf8
    export LANGUAGE=en_US.utf8
    export LANG=en_US.utf8
fi

# Set up Github Copilot alias
eval "$(gh copilot alias -- bash)"
alias cps='ghcs'
alias cpe='ghce'

export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

[[ -f ~/.bash-preexec.sh ]] && source ~/.bash-preexec.sh

test -f ~/.bashrc.local && source ~/.bashrc.local

# Make this the last return value,
# so we don't have an exit status of the test command on our prompt
true
