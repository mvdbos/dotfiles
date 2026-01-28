# Copilot Setup and Validation Instructions

## Overview
This document defines the validation process that must be run whenever changes are made to the dotfiles configuration for bash or zsh.

## Key Files

- **`stow_dotfiles.sh`**: Centralized stow logic used by both `setup.sh` and `validate_setup.sh`
- **`validate_setup.sh`**: Validation script that tests the configuration
- **`setup.sh`**: Main setup script that installs all packages

## Validation Requirement

**MANDATORY**: Run `./validate_setup.sh` after ANY changes to:
- `bash/.bashrc`
- `zsh/.zshrc` 
- `shell/.profile`
- `shell/.config/shell/aliases`
- `shell/.config/shell/functions`
- `setup.sh`
- `stow_dotfiles.sh`

## Running Validation

From the dotfiles repository root:

```bash
./validate_setup.sh
```

This script:
1. Creates a clean test environment in `/tmp`
2. Simulates `git clone` by copying dotfiles to `~/.dotfiles`
3. Runs the stow commands from `setup.sh`
4. Tests bash and zsh configurations
5. Validates that functions and aliases load correctly

## Expected Results

### All Tests Must Pass for Bash:
- ✓ Stowed shell
- ✓ Stowed bash
- ✓ Stowed zsh
- ✓ .bashrc symlink
- ✓ .profile symlink
- ✓ Shell aliases
- ✓ Shell functions
- ✓ Bash: cdbm function
- ✓ Bash: gfp alias
- ✓ Bash: .bashrc sourced
- ✓ Bash: cd works

### Zsh Tests:
- Note: Zsh tests may fail in non-interactive mode (expected)
- Manual verification: `zsh -i -c "type cdbm; alias gfp"` should work

## Manual Testing

### Bash Interactive Test
```bash
# Create test environment
TEST_HOME=/tmp/test_dotfiles_$$
mkdir -p $TEST_HOME
cd $(pwd)  # your dotfiles dir
cp -r . $TEST_HOME/.dotfiles
cd $TEST_HOME/.dotfiles

# Run stow
stow -R shell
stow -R bash

# Test in bash
HOME=$TEST_HOME bash -i
# Then in the shell:
type cdbm      # Should show function
alias gfp      # Should show alias
cd /tmp        # Should work with ls output
```

### Zsh Interactive Test
```bash
# Continue from bash test above
stow -R zsh

# Test in zsh  
HOME=$TEST_HOME zsh -i
# Then in the shell:
type cdbm      # Should show function
alias gfp      # Should show alias
cd /tmp        # Should work with ls output
```

## Setup.sh Workflow

The actual user workflow that validation simulates:

```bash
# User installs dotfiles
cd ~
git clone https://github.com/username/dotfiles.git .dotfiles
cd .dotfiles
./setup.sh
```

The `setup.sh` script:
1. Detects platform (macOS/Linux/etc)
2. Runs platform-specific setup
3. Runs `stow -R shell bash zsh` (and other packages)
4. Sets up additional tools (git extensions, bat themes, etc)

## Key Points

1. **Stow must be run from ~/.dotfiles** (not from parent directory)
2. **Shell/bash/zsh must all be stowed** for configuration to work
3. **Bash requires interactive shell** for full configuration loading
4. **Zsh requires interactive shell** for full configuration loading
5. **.profile is sourced by .bashrc** (prevents circular sourcing with BASHRC_SOURCED guard)
6. **Functions and aliases are in shared shell/** directory

## Troubleshooting

If validation fails:

1. **Check stow output**: Are symlinks being created?
   ```bash
   ls -la ~/.bashrc ~/.profile ~/.config/shell/
   ```

2. **Check file contents**: Are files being sourced?
   ```bash
   bash -x ~/.bashrc 2>&1 | grep "source.*aliases"
   ```

3. **Test functions directly**:
   ```bash
   source ~/.config/shell/functions
   type cdbm
   ```

4. **Check for syntax errors**:
   ```bash
   bash -n ~/.bashrc
   zsh -n ~/.zshrc
   ```

## Integration with CI/CD

To add to CI pipeline:

```yaml
- name: Validate dotfiles setup
  run: |
    sudo apt-get install -y stow zsh
    cd dotfiles
    ./validate_setup.sh
```

## Copilot Agent Instructions

When making changes to shell configuration files:

1. **ALWAYS run validation** before committing
2. **Ensure all bash tests pass** (11+ tests)
3. **Document any breaking changes** in TROUBLESHOOTING.md
4. **Test both shells**: bash AND zsh (if available)
5. **Commit validation script with changes** if validation logic changes

## Version History

- 2026-01-28: Initial validation script created
- Tests cover: stow operations, symlinks, bash functions/aliases, zsh functions/aliases
