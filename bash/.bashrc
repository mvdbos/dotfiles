PATH="/usr/local/bin:/usr/local/sbin:$PATH"
PATH="~/.bin:$PATH"

source ~/.dotfiles/platform_detector.bash

# If not running interactively, don't do anything
case $- in
    *i*) ;;
    *) return;;
esac

# don't put duplicate lines or lines starting with space in the history.
# See bash(1) for more options
HISTCONTROL=ignoreboth:erasedups

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=100000
HISTFILESIZE=100000

export HISTTIMEFORMAT="%F %T "          ## Adds time to history
export HISTIGNORE='ls:bg:fg:history'    ## Hist ignores exact match

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# Add autocorrect to dirnames
shopt -s cdspell

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
    alias dircolors='gdircolors'
    alias dir='gdir'
else
    alias ls='ls -F1B --group-directories-first --color=auto'
    alias rm='rm -I'
    alias mv='mv -iu --strip-trailing-slashes'
    alias df='df -h --total'
fi

export WGETRC="${HOME}/.config/wget/wgetrc"
alias wget='wget --execute ca_certificate=~/.config/certs/insg3_b64.cer --hsts-file=~/.config/wget/wget-hsts-db'

# enable color support of ls and also add handy aliases
test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
alias dir='dir --color=auto'
alias vdir='vdir --color=auto'
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

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
function cdls () { builtin cd "$@" && ls; }
alias cd='cdls'
alias l='ls'
alias lrt='ls -rt'
alias ll='ls -ohgBv --group-directories-first'
alias la='ls -lAhvG --group-directories-first'
alias ps="ps fax"
alias psg="ps aux | grep -v grep | grep -i -e VSZ -e"

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
elif [ "$PLATFORM_IS_ANDROID" -eq 1 ]; then
    test -f $PREFIX/etc/bash_completion.d/git-prompt && source $PREFIX/etc/bash_completion.d/git-prompt
    test -f $PREFIX/usr/share/bash-completion/bash_completion && source $PREFIX/usr/share/bash-completion/bash_completion
    test -f $PREFIX/usr/share/bash-completion/completions/git && source $PREFIX/usr/share/bash-completion/completions/git
fi

function git_prompt_pre() {
    local exit_code="$?"

    prompt_string="\n"

    local RCol='\[\e[0m\]'

    local Gry='\[\e[0;90m\]'
    local Red='\[\e[0;31m\]'
    local Yel='\[\e[0;33m\]'
    local BBlu='\[\e[1;34m\]'
    local Mag='\[\e[0;35m\]'

    # Show current time
    prompt_string+="${Gry}[$(date +%H:%M)] ${RCol}"

    # Show exit code if non-zero
    if [ $exit_code != 0 ]; then
        prompt_string+="${Red}(${exit_code}) ${RCol}"
    fi

    # Check Jobs
    type jobs &>/dev/null
    if [ $? == "0" ]; then
        ## Backgrounded running jobs
        local jobs=$(jobs -r | wc -l | tr -d ' ')
        ## Stopped Jobs
        local jobs=$((jobs + $(jobs -s | wc -l | tr -d ' ')))

        if [ ${jobs} -gt 0 ]; then
            prompt_string+="${Yel}jobs:${jobs}${RCol} "
        fi
    fi

    # Only show hostname if not on localhost
    if [ -n "$SSH_CLIENT" ] || [ -n "$SSH_TTY" ]; then
        prompt_string+="${Mag}\h${RCol}:"
    fi

    prompt_string+="${BBlu}\w${RCol}"
    echo -n $prompt_string
}

function git_prompt_post() {
    echo -n " \\\$ "
}

# Set the truncation length of \w (current working dir) in prompt
export PROMPT_DIRTRIM=3

# Git prompt settings
export GIT_PS1_SHOWDIRTYSTATE=true
export GIT_PS1_SHOWUNTRACKEDFILES=true
export GIT_PS1_SHOWUPSTREAM=auto
export GIT_PS1_SHOWCOLORHINTS=true
PROMPT_COMMAND='__git_ps1 "$(git_prompt_pre)" "$(git_prompt_post)"'

# enable git completion on 'g' alias in addition to 'git'
__git_complete g __git_main
__git_complete ga _git_add
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
alias gb='g branch'
alias gc='g ci'
alias gco='g co'
alias gd='g diff'
alias gf='g fetch --all'
alias gfd='g fetch && g delete-merged-branches'
alias gfp='g fetch && g pull --recurse-submodules && g delete-merged-branches '
alias gg='g gr'
alias gl='g lg'
alias glm='g lg origin/master..'
alias glc='g log -1 -u'
alias gp='g push'
alias gr='g rebase'
alias gs='g st'
alias gw="g log --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %C(white)%s %Cgreen(%cr)%Creset %C(blue)(%an)%Creset %n%+b' --stat --no-merges  --date=relative --ignore-all-space --ignore-blank-lines  --ignore-space-at-eol  --ignore-space-change"
alias gwip="git add . && git commit -m 'WIP' --no-verify  && git push"


# load source files
if [[ $PLATFORM_IS_DARWIN -eq 1 ]]; then
    export LC_ALL=en_US.UTF-8
    export LANG=en_US.UTF-8
elif [[ $PLATFORM_IS_UBUNTU -eq 1 ]]; then
    export LC_ALL=en_US.utf8
    export LANGUAGE=en_US.utf8
    export LANG=en_US.utf8
fi

# Settings for go
export GOPATH=$HOME/.go
PATH=$PATH:$GOPATH/bin

test -f ~/.bashrc.local && source ~/.bashrc.local

# Make this the last return value,
# so we don't have an exit status of the test command on our prompt
true
