# stow_dotfiles.sh

Centralized stow logic for dotfiles. This script provides a reusable function to stow dotfiles packages, used by both `setup.sh` and `validate_setup.sh`.

## Purpose

This script extracts the common stow logic into a single place, making it easier to:
- Maintain consistent stow behavior across scripts
- Add or modify stow packages in one place
- Test the stow process independently

## Usage

### As a sourced script

```bash
source stow_dotfiles.sh
stow_dotfiles                 # Stow all packages
stow_dotfiles --essential-only  # Only stow shell, bash, zsh
```

### As a standalone script

```bash
./stow_dotfiles.sh            # Stow all packages
./stow_dotfiles.sh --essential-only  # Only stow essential packages
./stow_dotfiles.sh --help     # Show help
```

## What gets stowed

### Essential packages (--essential-only)
- `shell` - Shared configuration (aliases, functions, .profile)
- `bash` - Bash-specific configuration
- `zsh` - Zsh-specific configuration

### All packages (default)
- All essential packages above
- `vim` - Vim configuration
- `certs` - SSL certificates
- `wget` - Wget configuration
- `ssh` - SSH configuration
- `git` - Git configuration (with special .gitconfig handling)
- `phoenix` - Phoenix window manager (macOS only)
- `ideavim` - IntelliJ Vim plugin (macOS only)

## Integration

### setup.sh
The main setup script sources `stow_dotfiles.sh` and calls `stow_dotfiles` to install all packages:

```bash
source stow_dotfiles.sh
stow_dotfiles
```

### validate_setup.sh
The validation script sources `stow_dotfiles.sh` but runs individual stow commands for better error reporting:

```bash
source stow_dotfiles.sh
stow -R shell  # Individual commands for test reporting
stow -R bash
stow -R zsh
```

## Benefits

1. **Single source of truth**: Stow logic defined in one place
2. **Easier maintenance**: Add/remove packages in one file
3. **Consistent behavior**: Same logic across setup and validation
4. **Testable**: Can be tested independently
5. **Flexible**: Can stow all or just essential packages

## Example

```bash
# In a new environment, stow just the shell configs
cd ~/.dotfiles
source stow_dotfiles.sh
stow_dotfiles --essential-only

# Later, stow everything
stow_dotfiles
```
