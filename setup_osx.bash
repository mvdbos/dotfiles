echo "Installing Homebrew..."
if which brew 2>/dev/null 1>/dev/null; then
    echo "Homebrew already installed."
else
    ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
fi

brew update
brew install \
    bash bash-completion bat coreutils colordiff curl git git-extras htop the_silver_searcher stow tree vim wget
brew cleanup -s
brew analytics off
