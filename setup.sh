#!/usr/bin/env bash

source error_handler.bash

PLATFORM_NAME=`uname`

if [ "$PLATFORM_NAME" == "Darwin" ]; then
    echo "Detected OS X install, proceeding with OS X setup..."
    bash setup_osx.bash
else
    echo "Detected Linux install, proceeding with Linux setup..."
    bash setup_linux.bash
fi

echo "Updating submodules..."
git submodule init --quiet
git submodule update --quiet
git submodule foreach --quiet git pull --quiet origin master

echo "Restowing common apps..."
stow -R bash
stow -R git
stow -R vim
stow -R certs
stow -R wget 

if [ "$PLATFORM_NAME" == "Darwin" ]; then
    echo "Restowing Mac apps..."
    stow -R phoenix
    stow -R ideavim
fi

# Add Dracula theme for bat
echo "Adding Dracula theme for bat..."
theme_dir="$(bat --config-dir)/themes/dracula"
mkdir -p "$theme_dir"
wget https://raw.githubusercontent.com/dracula/sublime/master/Dracula.tmTheme -q --directory-prefix="$theme_dir"
bat cache --build
