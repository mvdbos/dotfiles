#!/usr/bin/env bash
#
# setup_zsh_darwin.sh - Darwin (macOS) only zsh setup
#
# This script sets up zsh with Oh My Zsh and required plugins on macOS.
# It ensures Homebrew prerequisites, installs Oh My Zsh, and stows zsh configuration.
#
# Usage:
#   bash setup_zsh_darwin.sh
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

# Check if running on Darwin (macOS)
if [[ "$(uname -s)" != "Darwin" ]]; then
    echo_error "This script is for Darwin (macOS) only."
    echo_error "Detected: $(uname -s)"
    exit 1
fi

echo_success "Running on Darwin (macOS)"

# Ensure Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo_info "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for this session
    if [[ -d "/opt/homebrew/bin" ]]; then
        export PATH="/opt/homebrew/bin:$PATH"
    fi
    
    echo_success "Homebrew installed"
else
    echo_success "Homebrew is already installed"
fi

# Ensure zsh is installed
if ! command -v zsh &> /dev/null; then
    echo_info "Installing zsh via Homebrew..."
    brew install zsh
    echo_success "zsh installed"
else
    echo_success "zsh is already installed ($(zsh --version))"
fi

# Ensure stow is installed (required for stowing dotfiles)
if ! command -v stow &> /dev/null; then
    echo_info "Installing stow via Homebrew..."
    brew install stow
    echo_success "stow installed"
else
    echo_success "stow is already installed"
fi

# Ensure git is installed (required for Oh My Zsh)
if ! command -v git &> /dev/null; then
    echo_info "Installing git via Homebrew..."
    brew install git
    echo_success "git installed"
else
    echo_success "git is already installed"
fi

# Ensure bat is installed (used in zprofile)
if ! command -v bat &> /dev/null; then
    echo_info "Installing bat via Homebrew..."
    brew install bat
    echo_success "bat installed"
else
    echo_success "bat is already installed"
fi

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

# Stow all dotfiles using centralized function
echo_info "Stowing dotfiles configuration..."
cd "$(dirname "$0")"

# Source and use the centralized stow function
export PLATFORM_NAME="Darwin"
source ./stow_dotfiles.sh
stow_dotfiles
echo_success "Dotfiles stowed successfully"

# Optional: Change default shell to zsh
current_shell="$(dscl . -read ~/ UserShell | awk '{print $2}')"
zsh_path="$(command -v zsh)"

if [[ "$current_shell" != "$zsh_path" ]]; then
    echo ""
    echo_info "Your current shell is: $current_shell"
    echo_info "To change your default shell to zsh, run:"
    echo "    chsh -s $zsh_path"
else
    echo_success "Default shell is already zsh"
fi

echo ""
echo_success "Zsh setup complete!"
echo ""
echo "Next steps:"
echo "  1. Restart your terminal or run: source ~/.zshrc"
echo "  2. If you haven't already, change your default shell: chsh -s $(command -v zsh)"
echo ""
