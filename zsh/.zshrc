# Path to oh-my-zsh installation
export ZSH="$HOME/.oh-my-zsh"

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
