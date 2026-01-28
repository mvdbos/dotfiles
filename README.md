# Dotfiles

Personal dotfiles managed with GNU Stow.

## Install

Clone this repository into your home directory:
```bash
cd
git clone https://github.com/mvdbos/dotfiles.git .dotfiles
cd .dotfiles
./setup.sh
```

## Structure

This repository is organized into stow packages:

- **shell** - Shared shell configuration (bash and zsh compatible)
  - `.profile` - Common environment variables and PATH setup
  - `.config/shell/aliases` - Shell-agnostic aliases
  - `.config/shell/functions` - Shell-agnostic functions
  - `.dircolors` - Color configuration for ls
  - `.bin/` - Custom utility scripts
  
- **bash** - Bash-specific configuration
  - `.bashrc` - Bash interactive shell configuration
  - `.inputrc` - Readline configuration for vi mode
  - `.bash-preexec.sh` - Preexec/precmd hooks for bash
  
- **zsh** - Zsh-specific configuration
  - `.zshrc` - Zsh interactive shell configuration
  - `.zprofile` - Zsh login shell configuration
  
- **vim** - Vim configuration
- **git** - Git configuration
- **ssh** - SSH configuration
- **wget** - Wget configuration
- **certs** - Certificate files
- **phoenix** - Phoenix window manager (macOS)
- **ideavim** - IdeaVim configuration

## Usage

### Installing individual packages

To install a specific configuration package:
```bash
cd ~/.dotfiles
stow PACKAGE_NAME
```

For example:
```bash
stow bash    # Install bash configuration
stow zsh     # Install zsh configuration
stow vim     # Install vim configuration
```

### Uninstalling packages

To uninstall a package:
```bash
stow -D PACKAGE_NAME
```

### Re-installing packages

To re-install (useful after pulling updates):
```bash
stow -R PACKAGE_NAME
```

## Shell Configuration

The dotfiles support both bash and zsh with a shared core configuration:

1. **Common configuration** (in `shell/`): Aliases, functions, environment variables, and utilities that work across both shells.

2. **Bash-specific** (in `bash/`): Bash history settings, prompt configuration, completion setup, and bash-preexec hooks.

3. **Zsh-specific** (in `zsh/`): Zsh options (replacing bash's shopt), native preexec/precmd hooks, zsh completion system, and zsh prompt.

### Switching shells

To use zsh instead of bash:
1. Install zsh: `brew install zsh` (macOS) or `apt install zsh` (Linux)
2. Run setup.sh again (it will detect zsh and install the zsh stow automatically)
3. Change your default shell: `chsh -s $(which zsh)`

Both shells share the same aliases, functions, and utilities, so your workflow remains consistent.
