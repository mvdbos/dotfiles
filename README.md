# Install

Clone this repository into your home directory:
```bash
cd
git clone https://github.com/mvdbos/dotfiles.git .dotfiles
cd .dotfiles
./setup.sh
```

To uninstall configs for specific apps, you can do so by running `stow -D APPNAME` from the `.dotfiles` directory.
To re-install, run `stow APPNAME`.
