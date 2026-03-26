#!/usr/bin/env bash
#
# setup_zsh_linux.sh - Linux zsh setup
#
# This script sets up zsh with Oh My Zsh and required plugins on Linux (Ubuntu/Debian).
# It installs prerequisites via apt, installs Oh My Zsh, and stows zsh configuration.
#
# Usage:
#   bash setup_zsh_linux.sh
#

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_success() {
    echo -e "${GREEN}✓${NC} $1"
}

echo_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

echo_info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Check if running on Linux
if [[ "$(uname -s)" != "Linux" ]]; then
    echo_error "This script is for Linux only."
    echo_error "Detected: $(uname -s)"
    exit 1
fi

echo_success "Running on Linux"

# Ensure prerequisites are installed via apt
MISSING_PKGS=()
for pkg in zsh stow git curl bat; do
    if ! command -v "$pkg" &> /dev/null && ! command -v "bat${pkg#bat}" &> /dev/null; then
        MISSING_PKGS+=("$pkg")
    fi
done

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    echo_info "Installing missing packages: ${MISSING_PKGS[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends "${MISSING_PKGS[@]}"
fi

# On Ubuntu, bat is installed as 'batcat' — create a symlink if needed
if ! command -v bat &> /dev/null && command -v batcat &> /dev/null; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$(command -v batcat)" "$HOME/.local/bin/bat"
    export PATH="$HOME/.local/bin:$PATH"
    echo_success "bat symlinked from batcat"
fi

echo_success "zsh is installed ($(zsh --version))"
echo_success "stow is installed"
echo_success "git is installed"
echo_success "bat is installed"

# Install Oh My Zsh if not already installed
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
    echo_info "Installing Oh My Zsh..."
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
    echo_success "Oh My Zsh installed"
else
    echo_success "Oh My Zsh is already installed"
fi

# Install zsh-autosuggestions plugin
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [[ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]]; then
    echo_info "Installing zsh-autosuggestions plugin..."
    git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
    echo_success "zsh-autosuggestions plugin installed"
else
    echo_success "zsh-autosuggestions plugin is already installed"
fi

# Install zsh-syntax-highlighting plugin
if [[ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]]; then
    echo_info "Installing zsh-syntax-highlighting plugin..."
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
    echo_success "zsh-syntax-highlighting plugin installed"
else
    echo_success "zsh-syntax-highlighting plugin is already installed"
fi

# Install Dracula theme for Oh My Zsh
if [[ ! -d "$ZSH_CUSTOM/themes/dracula" ]]; then
    echo_info "Installing Dracula theme for Oh My Zsh..."
    git clone https://github.com/dracula/zsh.git "$ZSH_CUSTOM/themes/dracula"
    ln -sf "$ZSH_CUSTOM/themes/dracula/dracula.zsh-theme" "$ZSH_CUSTOM/themes/dracula.zsh-theme"
    echo_success "Dracula theme installed"
else
    echo_success "Dracula theme is already installed"
fi

# Install Dracula theme for bat
echo_info "Installing Dracula theme for bat..."
theme_dir="$(bat --config-dir)/themes/dracula"
mkdir -p "$theme_dir"
curl --silent --show-error -o "$theme_dir/Dracula.tmTheme" https://raw.githubusercontent.com/dracula/sublime/master/Dracula.tmTheme
bat cache --build > /dev/null 2>&1
echo_success "Dracula theme for bat installed"

# Stow shell, bash, and zsh dotfiles
# Remove pre-existing files the base OS image ships that would conflict with stow
echo_info "Stowing dotfiles configuration..."
rm -f "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc" "$HOME/.zprofile"
cd "$(dirname "$0")"

export PLATFORM_NAME="Linux"
source ./stow_dotfiles.sh
stow_dotfiles --essential-only
echo_success "Dotfiles stowed successfully"

# Change default shell to zsh
zsh_path="$(command -v zsh)"
current_user="$(whoami)"
current_shell="$(getent passwd "$current_user" | cut -d: -f7)"

if [[ "$current_shell" != "$zsh_path" ]]; then
    echo_info "Changing default shell to zsh..."
    sudo chsh -s "$zsh_path" "$current_user" && echo_success "Default shell set to zsh" || echo_info "Could not change default shell (set it manually with: chsh -s $zsh_path)"
else
    echo_success "Default shell is already zsh"
fi

echo ""
echo_success "Zsh setup complete!"
echo ""
echo "Next steps:"
echo "  1. Restart your terminal or run: source ~/.zshrc"
echo ""
