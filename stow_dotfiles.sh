#!/usr/bin/env bash
#
# stow_dotfiles.sh - Centralized stow logic for dotfiles
#
# This script provides a reusable function to stow dotfiles packages.
# It can be sourced by setup.sh, validate_setup.sh, and other scripts.
#
# Usage:
#   source stow_dotfiles.sh
#   stow_dotfiles [--essential-only]
#
# Options:
#   --essential-only    Only stow shell, bash, and zsh (for validation)
#   --help              Show this help message
#

# Function to stow all packages (including optional ones)
stow_all() {
    echo "Restowing common apps..."
    
    # Essential packages
    stow -R shell
    stow -R bash
    
    # Optional packages
    stow -R vim
    stow -R certs
    stow -R wget
    stow -R ssh
    
    # Git (with special handling for .gitconfig)
    rm -f ~/.gitconfig
    stow -R git
    
    # Always stow zsh configuration to allow switching shells at will
    echo "Installing zsh configuration..."
    stow -R zsh
    
    # Platform-specific packages
    if [ "$PLATFORM_NAME" = "Darwin" ]; then
        echo "Restowing Mac apps..."
        stow -R phoenix
        stow -R ideavim
    fi
    
    return 0
}

# Main function that determines what to stow
stow_dotfiles() {
    local essential_only=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --essential-only)
                essential_only=true
                shift
                ;;
            --help)
                grep "^#" "$0" | grep -v "^#!/" | sed 's/^# //' | sed 's/^#//'
                return 0
                ;;
            *)
                echo "Unknown option: $1"
                echo "Use --help for usage information"
                return 1
                ;;
        esac
    done
    
    # Execute appropriate stow function
    if [ "$essential_only" = "true" ]; then
        # Only stow essential packages (for validation)
        stow -R shell
        stow -R bash
        stow -R zsh
    else
        stow_all
    fi
    
    return $?
}

# If script is executed directly (not sourced), run the main function
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    stow_dotfiles "$@"
fi
