source error_handler.bash

echo "Installing Apt packages..."
 pkg install -qqy \
    bash bash-completion bat colordiff coreutils curl git htop silversearcher-ag stow tree vim wget
