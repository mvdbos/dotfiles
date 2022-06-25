source error_handler.bash

# Install Homebrew
if !which brew 2>/dev/null 1>/dev/null; then
    echo "Installing Homebrew..."
    ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
fi

# Install Homebrew bundle
brew bundle install --no-upgrade --file=Brewfile

# Install SDKMan
curl -s "https://get.sdkman.io?rcupdate=false" | bash
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

# Install Java 8
sdk install java 8.0.332-zulu

echo "Setting iTerm preference file location"
# Specify the preferences directory
defaults write com.googlecode.iterm2.plist PrefsCustomFolder -string "~/.dotfiles/iterm2"
# Tell iTerm2 to use the custom preferences in the directory
defaults write com.googlecode.iterm2.plist LoadPrefsFromCustomFolder -bool true
