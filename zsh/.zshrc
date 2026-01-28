# Path to oh-my-zsh installation
export ZSH="$HOME/.oh-my-zsh"

# Disable insecure directory warnings (useful in CI/test environments)
# Remove this line if you want the security checks enabled
ZSH_DISABLE_COMPFIX="true"

# Set oh-my-zsh theme
# Popular themes: robbyrussell (default), agnoster, powerlevel10k/powerlevel10k
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
ZSH_THEME="robbyrussell"

# Oh-My-Zsh plugins
# Standard plugins: git, docker, kubectl, aws, npm, yarn, etc.
# Custom plugins can be added to ~/.oh-my-zsh/custom/plugins/
plugins=(
    git
    docker
    kubectl
    colored-man-pages
    command-not-found
    extract
)

# Source oh-my-zsh
source $ZSH/oh-my-zsh.sh

# Source shared profile for PATH and environment variables
# Only for non-login shells (login shells source .profile via .zprofile)
if [[ ! -o login ]] && [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
fi

# Source shared aliases (non-git aliases only)
if [ -f "$HOME/.config/shell/aliases" ]; then
    source "$HOME/.config/shell/aliases"
fi

# Source shared functions
if [ -f "$HOME/.config/shell/functions" ]; then
    source "$HOME/.config/shell/functions"
fi

# Set up cd alias to use the bookmark function
# This overrides oh-my-zsh's cd if needed
alias cd='cdbm'
alias ..='up 1'
alias ...='up 2'
alias ....='up 3'

# Custom git aliases that differ from oh-my-zsh defaults
# Note: oh-my-zsh git plugin provides many aliases, but these are customized
# These override or supplement the oh-my-zsh git plugin
alias gd='clear && git diff'                    # Clear screen before diff
alias gdm='git diff origin/master'              # Diff against origin/master
alias gfp='git fetch && git pull --recurse-submodules && git delete-merged-branches && git-delete-squashed-branches'
alias gl='git lg'                               # Use custom 'lg' alias (not git pull)
alias glm='git lg origin/master..'              # Log from origin/master
alias glc='git log -1 -u'                       # Last commit with diff
alias gw="git log --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %C(white)%s %Cgreen(%cr)%Creset %C(blue)(%an)%Creset %n%+b' --stat --no-merges --date=relative --ignore-all-space --ignore-blank-lines --ignore-space-at-eol --ignore-space-change"
alias gwip="git add . && git commit -m 'WIP' --no-verify && git push"
alias git-delete-local-orphan-branches="git branch -vv | awk '\$1 != \"*\"' | awk '\$4 ~ /gone\]/ || \$3 !~ /\[origin\// {print \$1}' | xargs -p -n 1 git branch -D"
alias gdom="gd origin/master"

# Aliases that use git command shortcuts (assumes git config aliases: ci, co, st, lg, bl, brem, gbm, gr)
# These work if you have git aliases configured in ~/.gitconfig
alias gbl='git bl | grep -v year | grep -v month'       # Custom git blame filtering
alias gbr='git brem | grep -v year | grep -v month'     # Custom remote branch filtering  
alias gb='git gbm'                                       # Uses git gbm alias
alias gc='git ci'                                        # Uses git ci alias
alias gs='git st'                                        # Uses git st alias
alias gr='git rebase'                                    # Standard rebase
alias gg='git gr'                                        # Uses git gr alias

# User configuration

# History configuration (oh-my-zsh sets good defaults, but we can override)
HISTFILE=~/.zsh_history
HISTSIZE=100000
SAVEHIST=100000
setopt HIST_IGNORE_SPACE        # Don't record entries starting with space
setopt HIST_VERIFY              # Show command with history expansion before running it

# Vi mode (if you prefer vi mode over emacs, uncomment below)
# bindkey -v
# export KEYTIMEOUT=1

# Additional shell options
setopt NO_BEEP                  # Don't beep on errors
setopt AUTO_CD                  # Type directory name to cd into it
setopt AUTO_PUSHD               # Make cd push old directory onto directory stack
setopt PUSHD_IGNORE_DUPS        # Don't push multiple copies of same directory
setopt INTERACTIVE_COMMENTS     # Allow comments in interactive shells

# Source local overrides if they exist
[ -f ~/.zshrc.local ] && source ~/.zshrc.local

# Make this the last return value
true
