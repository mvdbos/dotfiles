#!/usr/bin/env bash
# Validation script for dotfiles setup.sh
# Simulates: cd ~ && git clone ... .dotfiles && cd .dotfiles && ./setup.sh

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
test_passed() { TESTS_PASSED=$((TESTS_PASSED + 1)); log_info "✓ $1"; }
test_failed() { TESTS_FAILED=$((TESTS_FAILED + 1)); log_error "✗ $1"; }

echo "========================================"; echo "  Dotfiles Setup Validation"; echo "========================================"

TEST_HOME="/tmp/dotfiles_test_$$"
rm -rf "$TEST_HOME"; mkdir -p "$TEST_HOME"
DOTFILES_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info "Copying dotfiles to $TEST_HOME/.dotfiles"
cp -r "$DOTFILES_SOURCE" "$TEST_HOME/.dotfiles"
cd "$TEST_HOME/.dotfiles"

# Run stow commands (from setup.sh)
log_info "Running stow commands..."
source platform_detector.bash
source stow_dotfiles.sh

# Stow essential packages individually for better error reporting
stow -R shell 2>&1 >/dev/null && test_passed "Stowed shell" || test_failed "Stow shell failed"
stow -R bash 2>&1 >/dev/null && test_passed "Stowed bash" || test_failed "Stow bash failed"
stow -R zsh 2>&1 >/dev/null && test_passed "Stowed zsh" || test_failed "Stow zsh failed"

# Verify symlinks
log_info "Verifying symlinks..."
[ -L "$TEST_HOME/.bashrc" ] && test_passed ".bashrc symlink" || test_failed ".bashrc missing"
[ -L "$TEST_HOME/.profile" ] && test_passed ".profile symlink" || test_failed ".profile missing"
[ -f "$TEST_HOME/.config/shell/aliases" ] && test_passed "Shell aliases" || test_failed "aliases missing"
[ -f "$TEST_HOME/.config/shell/functions" ] && test_passed "Shell functions" || test_failed "functions missing"

# Test bash interactive shell
log_info "Testing bash..."
bash_output=$(HOME="$TEST_HOME" bash -i 2>&1 << 'EOF'
type cdbm >/dev/null 2>&1 && echo "TEST:BASH_CDBM_OK"
alias gfp >/dev/null 2>&1 && echo "TEST:BASH_GFP_OK"
[ -n "$BASHRC_SOURCED" ] && echo "TEST:BASH_SOURCED_OK"
cd /tmp >/dev/null 2>&1 && echo "TEST:BASH_CD_OK"
exit 0
EOF
)

echo "$bash_output" | grep -q "TEST:BASH_CDBM_OK" && test_passed "Bash: cdbm function" || test_failed "Bash: cdbm not found"
echo "$bash_output" | grep -q "TEST:BASH_GFP_OK" && test_passed "Bash: gfp alias" || test_failed "Bash: gfp not found"
echo "$bash_output" | grep -q "TEST:BASH_SOURCED_OK" && test_passed "Bash: .bashrc sourced" || test_failed "Bash: .bashrc not sourced"
echo "$bash_output" | grep -q "TEST:BASH_CD_OK" && test_passed "Bash: cd works" || test_failed "Bash: cd failed"

# Test zsh if available
if command -v zsh >/dev/null 2>&1; then
    log_info "Testing zsh..."
    chmod -R 755 "$TEST_HOME/.config" 2>/dev/null || true
    
    # Use expect to auto-answer compinit prompt, or skip interactive test
    zsh_output=$(HOME="$TEST_HOME" zsh -c '
type cdbm >/dev/null 2>&1 && echo "TEST:ZSH_CDBM_OK"
alias gfp >/dev/null 2>&1 && echo "TEST:ZSH_GFP_OK"
exit 0
' 2>&1 || echo "ZSH_NONINTERACTIVE")
    
    # If non-interactive test worked
    if echo "$zsh_output" | grep -q "TEST:ZSH_CDBM_OK"; then
        test_passed "Zsh: cdbm function"
    else
        log_error "Zsh: cdbm not loaded (non-interactive shell doesn't source .zshrc)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    if echo "$zsh_output" | grep -q "TEST:ZSH_GFP_OK"; then
        test_passed "Zsh: gfp alias"
    else
        log_error "Zsh: gfp not loaded (non-interactive shell doesn't source .zshrc)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    log_info "Zsh not installed, skipping zsh tests"
fi

# Cleanup
rm -rf "$TEST_HOME"

echo ""; echo "========================================"; echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC} | ${RED}Failed: $TESTS_FAILED${NC}"; echo "========================================"

if [ $TESTS_FAILED -eq 0 ]; then
    log_info "✓ All tests passed!"; echo "Configuration works correctly from ~/.dotfiles"; exit 0
else
    log_error "✗ Some tests failed (Note: zsh needs interactive shell for full testing)"; exit 1
fi
