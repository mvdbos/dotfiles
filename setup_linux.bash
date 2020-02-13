echo "Installing packages..."
sudo apt-get update -qq
sudo apt-get install -qqy \
    bash bash-completion colordiff curl git git-extras htop markdown silversearcher-ag stow tree vim wget
sudo apt autoremove -qq

echo "Setting timezone to Europe/Amsterdam"
sudo timedatectl set-timezone Europe/Amsterdam

# bat is not available as standard package in 18.04
wget -q https://github.com/sharkdp/bat/releases/download/v0.12.1/bat_0.12.1_amd64.deb -O /tmp/bat.deb
sudo dpkg -i /tmp/bat.deb 1>/dev/null

