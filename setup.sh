#!/usr/bin/env bash

source error_handler.bash
source platform_detector.bash

if [[ $PLATFORM_IS_DARWIN -eq 1 ]]; then
    echo "Detected OS X, proceeding with setup..."
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
git submodule foreach --quiet git pull --rebase --quiet origin master

echo "Restowing common apps..."
stow -R bash
stow -R vim
stow -R certs
stow -R wget
stow -R ssh

# Handling annoying replacement of our .gitconfig symlink.
# If that has happened, simply remove it.
rm -f ~/.gitconfig
stow -R git

if [ "$PLATFORM_NAME" == "Darwin" ]; then
    echo "Restowing Mac apps..."
    stow -R phoenix
    stow -R ideavim
fi

# Add Dracula theme for bat
echo "Adding Dracula theme for bat..."
theme_dir="$(bat --config-dir)/themes/dracula"
mkdir -p "$theme_dir"
curl --silent --show-error -o $theme_dir/Dracula.tmTheme https://raw.githubusercontent.com/dracula/sublime/master/Dracula.tmTheme
bat cache --build
