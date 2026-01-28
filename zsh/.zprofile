# ~/.zprofile: executed by zsh for login shells
# This file is sourced before .zshrc

# Source the shared profile
if [ -f "$HOME/.profile" ]; then
    emulate sh -c '. "$HOME/.profile"'
fi
