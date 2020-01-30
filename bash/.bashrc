# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# don't put duplicate lines or lines starting with space in the history.
# See bash(1) for more options
HISTCONTROL=ignoreboth

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# make less more friendly for non-text input files, see lesspipe(1)
[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# uncomment for a colored prompt, if the terminal has the capability; turned
# off by default to not distract the user: the focus in a terminal window
# should be on the output of commands, not on the prompt
force_color_prompt=yes

if [ -n "$force_color_prompt" ]; then
    if [ -x /usr/bin/tput ] && tput setaf 1 >&/dev/null; then
	# We have color support; assume it's compliant with Ecma-48
	# (ISO/IEC-6429). (Lack of such support is extremely rare, and such
	# a case would tend to support setf rather than setaf.)
	color_prompt=yes
    else
	color_prompt=
    fi
fi


# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias dir='dir --color=auto'
    alias vdir='vdir --color=auto'

    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi

# colored GCC warnings and errors
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

# enable programmable completion features (you don't need to enable
# this, if it's already enabled in /etc/bash.bashrc and /etc/profile
# sources /etc/bash.bashrc).
if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
  fi
fi

# we always want to use Vim
export EDITOR="vim"
export VISUAL="vim"
export SVN_EDITOR="vim"

# Set bash to use vi as readline for the command line.
# Note: this is also done by the settings in .inputrc already. This is extra
set -o vi

function cdls () { builtin cd "$@" && ls; }
alias cd='cdls'

alias ls='ls -F1B --group-directories-first --color=auto'
alias l='ls'
alias lrt='ls -rt'
alias ll='ls -ohgBv --group-directories-first'
alias la='ls -lAhvG --group-directories-first'

alias df='df -h --total'

alias mv='mv -iu --strip-trailing-slashes'

alias rm='rm -I'
alias ps="ps fax"
alias psg="ps aux | grep -v grep | grep -i -e VSZ -e"

# Git prompt settings
source /etc/bash_completion.d/git-prompt
export GIT_PS1_SHOWDIRTYSTATE=true
export GIT_PS1_SHOWUNTRACKEDFILES=true
export GIT_PS1_SHOWUPSTREAM=auto
export GIT_PS1_SHOWCOLORHINTS=true
if [ "$color_prompt" = yes ]; then
    PROMPT_COMMAND='__git_ps1 "${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]" "\\\$ "'
else
    PROMPT_COMMAND='__git_ps1 "${debian_chroot:+($debian_chroot)}\u@\h:\w" "\\\$ "'
fi

source /usr/share/bash-completion/completions/git
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
alias gf='g fetch'
alias gfd='g fetch && g delete-merged-branches'
alias gfp='g fetch && g pull'
alias gg='g gr'
alias gl='g lg'
alias glm='g lg master..'
alias glc='g log -1 -u'
alias gp='g push'
alias gr='g rebase'
alias gs='g st'
alias gw="g log --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %C(white)%s %Cgreen(%cr)%Creset %C(blue)(%an)%Creset %n%+b' --stat --no-merges  --date=relative --ignore-all-space --ignore-blank-lines  --ignore-space-at-eol  --ignore-space-change"
alias gwip="git add . && git commit -m 'WIP' --no-verify  && git push"

