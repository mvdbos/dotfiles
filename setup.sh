#!/usr/bin/env bash

source error_handler.bash
source platform_detector.bash

if [[ $PLATFORM_IS_DARWIN -eq 1 ]]; then
    echo "Detected macOS, proceeding with setup..."
    bash setup_osx.bash
elif [[ $PLATFORM_IS_LINUX -eq 1 ]]; then

    if [[ $PLATFORM_IS_UBUNTU -eq 1 ]]; then
        echo "Detected $PLATFORM_NAME, proceeding with setup..."
        bash setup_ubuntu.bash
    elif [[ $PLATFORM_IS_RASPBERRY -eq 1 ]]; then
        echo "Detected $PLATFORM_NAME, proceeding with setup..."
        bash setup_raspberry.bash
    elif [[ $PLATFORM_IS_ANDROID -eq 1 ]]; then
        echo "Detected $PLATFORM_NAME, proceeding with setup..."
        bash setup_android.bash
    else
        echo -e "Unknown Linux detected, aborting." >&2
        exit 1
    fi

    # Remaining generic linux setup
    bash setup_linux.bash
else
    echo "Unknown OS detected, aborting."
    exit 1
fi

echo "Updating submodules..."
git submodule init --quiet
git submodule update --quiet
git submodule foreach --quiet git pull --rebase --quiet origin HEAD
git fetch
git pull --recurse-submodules
git delete-merged-branches
git-delete-squashed-branches

# Stow all dotfiles packages
source stow_dotfiles.sh
stow_dotfiles

# Install or update oh-my-zsh (idempotent)
if [ ! -d "$HOME/.oh-my-zsh" ]; then
    echo "Installing oh-my-zsh..."
    # Use unattended installation
    RUNZSH=no CHSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
else
    echo "oh-my-zsh already installed, updating..."
    # Update oh-my-zsh and plugins (using subshells to avoid changing working directory)
    if [ -d "$HOME/.oh-my-zsh" ]; then
        (cd "$HOME/.oh-my-zsh" && git pull --rebase --quiet origin master) || echo "Warning: Failed to update oh-my-zsh"
        # Update all custom plugins
        if [ -d "$HOME/.oh-my-zsh/custom/plugins" ]; then
            for plugin_dir in "$HOME/.oh-my-zsh/custom/plugins"/*; do
                if [ -d "$plugin_dir/.git" ]; then
                    echo "Updating plugin: $(basename "$plugin_dir")"
                    (cd "$plugin_dir" && git pull --rebase --quiet) || echo "Warning: Failed to update plugin $(basename "$plugin_dir")"
                fi
            done
        fi
    fi
fi

# Add Dracula theme for bat
echo "Adding Dracula theme for bat..."
theme_dir="$(bat --config-dir)/themes/dracula"
mkdir -p "$theme_dir"
curl --silent --show-error -o $theme_dir/Dracula.tmTheme https://raw.githubusercontent.com/dracula/sublime/master/Dracula.tmTheme
bat cache --build

# Add copilot plugin to gh
gh extension install github/gh-copilot
