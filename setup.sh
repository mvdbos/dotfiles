#!/usr/bin/env bash

PLATFORM_NAME=`uname`

if [ "$PLATFORM_NAME" == "Darwin" ]; then
    echo "Detected OS X install, proceeding with OS X setup..."
    bash setup_osx.bash
else
    echo "Detected Linux install, proceeding with Linux setup..."
    bash setup_linux.bash
fi

echo "Updating submodules..."
git submodule init
git submodule update
git submodule foreach git pull origin master

echo "Restowing common apps..."
stow -v -R bash
stow -v -R git
stow -v -R vim

if [ "$PLATFORM_NAME" == "Darwin" ]; then
    echo "Restowing Mac apps..."
    stow -v -R phoenix
fi
