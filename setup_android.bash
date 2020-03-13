source error_handler.bash

echo "Installing Apt packages..."
 pkg install \
    bash bash-completion colordiff curl git git-extras htop markdown silversearcher-ag stow tree vim wget

# bat is not available as standard package in 18.04
wget -q https://github.com/sharkdp/bat/releases/download/v0.12.1/bat_0.12.1_amd64.deb -O $TMPDIR/bat.deb
dpkg -i $TMPDIR/bat.deb 1>/dev/null

