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

# Install OpenCode dependencies if needed
if [ -f ~/.config/opencode/package.json ] && [ ! -d ~/.config/opencode/node_modules ]; then
    echo "Installing OpenCode dependencies..."
    if command -v bun &> /dev/null; then
        (cd ~/.config/opencode && bun install)
    elif command -v npm &> /dev/null; then
        (cd ~/.config/opencode && npm install)
    else
        echo "Warning: Neither bun nor npm found. OpenCode dependencies not installed."
        echo "Please install manually: cd ~/.config/opencode && npm install"
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
