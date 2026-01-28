# GitHub Copilot Instructions for Dotfiles Repository

## Purpose
This repository manages dotfiles configuration for bash and zsh shells using GNU Stow.

## Mandatory Validation

**CRITICAL**: Before committing ANY changes to shell configuration files, you MUST:

1. Run the validation script:
   ```bash
   ./validate_setup.sh
   ```

2. Ensure ALL bash tests pass (minimum 11 tests)

3. Verify the GitHub Actions workflow will pass

## Files Requiring Validation

Always run validation when modifying:
- `bash/.bashrc`
- `zsh/.zshrc`
- `shell/.profile`
- `shell/.config/shell/aliases`
- `shell/.config/shell/functions`
- `setup.sh`
- Any file that affects shell startup or configuration

## Expected Test Results

The validation script must show:
```
✓ Stowed shell
✓ Stowed bash
✓ Stowed zsh
✓ .bashrc symlink
✓ .profile symlink
✓ Shell aliases
✓ Shell functions
✓ Bash: cdbm function
✓ Bash: gfp alias
✓ Bash: .bashrc sourced
✓ Bash: cd works
```

**Minimum**: 11 tests must pass for bash configuration.

## Testing Workflow

1. **Make changes** to shell configuration files
2. **Run validation**: `./validate_setup.sh`
3. **Fix any failures** before committing
4. **Commit changes** only if all tests pass
5. **Push to PR** - GitHub Actions will run validation automatically

## Key Configuration Rules

### Directory Structure
- Dotfiles must be in `~/.dotfiles` directory
- Stow commands run FROM `~/.dotfiles` directory
- Symlinks are created in parent directory (`~`)

### Shell Startup
- **Bash**: `.bashrc` sources `.profile`, then shared aliases/functions
- **Zsh**: `.zshrc` sources `.profile` (only for non-login shells)
- **Shared**: `.config/shell/aliases` and `.config/shell/functions`

### Circular Sourcing Prevention
- `.bashrc` sets `BASHRC_SOURCED=1` before sourcing `.profile`
- `.profile` checks `BASHRC_SOURCED` before sourcing `.bashrc`

### Functions and Aliases
- `cdbm()`: CD with directory bookmarks and auto-ls
- `up()`: Navigate up multiple directory levels (uses `builtin cd`)
- `gfp`: Git fetch, pull, and cleanup alias
- All git shortcuts (g, ga, gc, gd, etc.)

## Common Pitfalls

❌ **DON'T**:
- Skip validation after shell config changes
- Commit if validation fails
- Modify stow directory structure without testing
- Create circular sourcing between .bashrc and .profile
- Use `cd` in functions that might be called by `cdbm` (use `builtin cd`)

✅ **DO**:
- Always run `./validate_setup.sh` before committing
- Test both bash and zsh when available
- Keep functions POSIX-compliant in shared files
- Document breaking changes in TROUBLESHOOTING.md
- Update COPILOT_SETUP.md if validation process changes

## GitHub Actions

The workflow `.github/workflows/copilot-setup-steps.yml` automatically:
1. Installs stow and zsh
2. Runs `./validate_setup.sh`
3. Reports pass/fail status
4. Blocks PRs if validation fails

## Troubleshooting

If validation fails:
1. Read the error message carefully
2. Check `TROUBLESHOOTING.md` for common issues
3. Run validation with verbose output: `bash -x ./validate_setup.sh`
4. Test manually: See COPILOT_SETUP.md for manual test procedures
5. Verify symlinks: `ls -la ~/.bashrc ~/.profile ~/.config/shell/`

## Documentation

- **COPILOT_SETUP.md**: Detailed validation procedures
- **TROUBLESHOOTING.md**: Common issues and solutions
- **README.md**: User installation instructions
- **MIGRATION.md**: Technical details about shell configuration structure

## Version Control

When making changes:
1. Create feature branch from `main`
2. Make changes and run validation
3. Commit with descriptive message
4. Push and create PR
5. GitHub Actions will validate automatically
6. Merge only if all checks pass

## Contact

For questions about validation or setup process, refer to:
- COPILOT_SETUP.md (technical details)
- TROUBLESHOOTING.md (common issues)
- This file (Copilot-specific guidelines)
