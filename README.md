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
  - Git aliases (moved from shared config)
  
- **zsh** - Zsh-specific configuration using Oh My Zsh
  - `.zshrc` - Oh My Zsh configuration with theme and plugins
  - `.zprofile` - Zsh login shell configuration
  - Uses Oh My Zsh git plugin for git aliases
  
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

1. **Common configuration** (in `shell/`): Non-git aliases, functions, environment variables, and utilities that work across both shells.

2. **Bash-specific** (in `bash/`): Bash history settings, prompt configuration, completion setup, bash-preexec hooks, and git aliases.

3. **Zsh-specific** (in `zsh/`): Oh My Zsh framework with themes and plugins, including the git plugin for git aliases.

### Switching shells

To use zsh instead of bash:
1. Install zsh: `brew install zsh` (macOS) or `apt install zsh` (Linux)
2. Run setup to install oh-my-zsh: `cd ~/.dotfiles && ./setup.sh`
3. Change your default shell: `chsh -s $(which zsh)`
4. Log out and log back in (or start a new terminal session)

The zsh configuration (with oh-my-zsh) is installed during setup. Both shells share core aliases, functions, and utilities for a consistent workflow. Note that git aliases differ between shells: bash uses custom aliases while zsh uses oh-my-zsh's git plugin.

## Troubleshooting

If you encounter "command not found" errors for `cdbm`, or other aliases after installation:

1. **Reload your shell**: Start a new terminal or run `source ~/.bashrc` (or `source ~/.zshrc`)
2. **Verify stow ran**: Check that symlinks exist: `ls -la ~/.bashrc ~/.config/shell/`
3. **Check for errors**: Run `bash -x ~/.bashrc` to see detailed execution
4. **For zsh**: Ensure oh-my-zsh is installed at `~/.oh-my-zsh` (run `./setup.sh` if missing)

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for detailed solutions to common issues.
