# GitHub Configuration

This directory contains GitHub-specific configuration files for the dotfiles repository.

## Files

### `.github/workflows/copilot-setup-steps.yml`
GitHub Actions workflow that automatically validates shell configuration changes.

**Triggers on**:
- Pull requests to `main` or `master` branches
- Pushes to `main` or `master` branches
- Manual workflow dispatch

**What it does**:
1. Checks out the repository
2. Installs dependencies (stow, zsh)
3. Runs `./validate_setup.sh`
4. Reports success/failure

**Monitored files**:
- `bash/.bashrc`
- `zsh/.zshrc`
- `shell/.profile`
- `shell/.config/shell/**`
- `setup.sh`
- `validate_setup.sh`

### `.github/copilot-instructions.md`
Instructions for GitHub Copilot agents working on this repository.

**Key guidelines**:
- MUST run validation before committing shell config changes
- Minimum 11 tests must pass for bash
- Explains directory structure and shell startup process
- Lists common pitfalls and best practices

## Usage

### Running Workflow Locally

To test if your changes will pass the GitHub Actions workflow:

```bash
# Install dependencies
sudo apt-get install -y stow zsh

# Run validation
./validate_setup.sh
```

### Manual Workflow Trigger

You can manually trigger the workflow from the GitHub Actions tab:
1. Go to repository Actions tab
2. Select "Validate Dotfiles Setup" workflow
3. Click "Run workflow"

## Integration with Copilot

When GitHub Copilot makes changes to shell configuration files, it will:
1. Automatically reference `copilot-instructions.md`
2. Know to run validation before committing
3. Understand the directory structure and requirements
4. Follow best practices for shell configuration

## Maintenance

When updating validation requirements:
1. Update `validate_setup.sh` (the actual test script)
2. Update `COPILOT_SETUP.md` (detailed technical docs)
3. Update `.github/copilot-instructions.md` (Copilot-specific guidelines)
4. Update `.github/workflows/copilot-setup-steps.yml` (if workflow needs changes)

Keep all documentation in sync to ensure consistent validation across:
- Local development
- GitHub Actions CI/CD
- Copilot agent behavior
