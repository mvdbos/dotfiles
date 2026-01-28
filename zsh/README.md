# Zsh Configuration

Zsh configuration using [Oh My Zsh](https://ohmyz.sh/) framework.

## Files

- **`.zshrc`** - Oh My Zsh configuration
  - Sources oh-my-zsh framework
  - Configures theme and plugins
  - Sources shared aliases and functions from `shell/`
  - Includes custom cd bookmark function
  
- **`.zprofile`** - Login shell configuration
  - Sources the shared `.profile`

- **`.zshrc.custom-backup`** - Previous custom zsh configuration (backup)

## Oh My Zsh

This dotfiles setup uses Oh My Zsh for zsh configuration. Oh My Zsh is a delightful, open source framework for managing your zsh configuration.

### Features

- 🎨 **Themes**: Over 150 themes to choose from
- 🔌 **Plugins**: 300+ plugins for git, docker, kubectl, and more
- 📦 **Easy to extend**: Custom themes and plugins support
- 🔄 **Auto-updates**: Keeps itself up to date

### Installation

Oh My Zsh is automatically installed when you run `./setup.sh`. The installation:
- Downloads oh-my-zsh to `~/.oh-my-zsh`
- Does not change your default shell (you can do this manually)
- Uses unattended mode (no prompts)

### Configuration

Edit `~/.dotfiles/zsh/.zshrc` to customize:

```bash
# Change theme
ZSH_THEME="agnoster"  # or any theme from ~/.oh-my-zsh/themes/

# Add/remove plugins
plugins=(
    git
    docker
    kubectl
    # ... add more plugins
)
```

### Popular Themes

- **robbyrussell** (default) - Simple, clean, shows git info
- **agnoster** - Powerline-style theme (requires powerline fonts)
- **powerlevel10k** - Fast, customizable (requires separate installation)
- See all themes: https://github.com/ohmyzsh/ohmyzsh/wiki/Themes

### Useful Plugins

Enabled by default:
- **git** - Provides many git aliases (gst, gco, gaa, etc.)
- **docker** - Docker command completion
- **kubectl** - Kubernetes completion
- **colored-man-pages** - Adds colors to man pages
- **command-not-found** - Suggests packages when command not found
- **extract** - Universal archive extractor (`extract <file>`)

See all plugins: https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins

### Git Aliases

Oh My Zsh provides comprehensive git aliases through its git plugin. Some examples:
- `gst` - git status
- `gco` - git checkout
- `gaa` - git add --all
- `gcmsg` - git commit -m
- `gp` - git push
- `gl` - git pull

Full list: https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/git

If you prefer different git aliases, disable the git plugin in `.zshrc` and define your own in `.zshrc.local`.

## Shared Files

Both bash and zsh use shared configuration from `shell/`:
- **`.profile`** - Environment variables and PATH setup
- **`.config/shell/aliases`** - Shell-agnostic aliases (ls, utilities, etc.)
- **`.config/shell/functions`** - Shell functions (up, cdbm)
- **`.bin/`** - Utility scripts
- **`.dircolors`** - LS colors

**Note**: Git aliases are now shell-specific:
- Bash users get git aliases in `bash/.bashrc`
- Zsh users get git aliases from oh-my-zsh git plugin

## Custom Directory Navigation

The custom `cdbm` function and `up` function from the shared shell config are preserved:

```bash
alias cd='cdbm'    # cd with directory bookmarks and auto-ls
alias ..='up 1'    # go up 1 directory
alias ...='up 2'   # go up 2 directories
```

These override oh-my-zsh defaults to maintain consistent behavior with the bash setup.

## Customization

To add local customizations that shouldn't be committed:

1. Create `~/.zshrc.local`
2. Add your custom configuration
3. It will be automatically sourced at the end of `.zshrc`

Example `~/.zshrc.local`:
```bash
# Custom git aliases (if you don't want oh-my-zsh's)
alias gs='git status'
alias gd='git diff'

# Custom functions
my_function() {
    echo "Hello from custom function"
}

# Override theme
ZSH_THEME="agnoster"
```

## Vi Mode

If you prefer vi mode (like the bash setup uses), uncomment these lines in `.zshrc`:

```bash
bindkey -v
export KEYTIMEOUT=1
```

## Platform Support

Fully supports the same platforms as bash:
- macOS (with Homebrew)
- Ubuntu Linux
- Raspberry Pi OS
- Android (Termux)

Platform-specific completion paths are automatically handled by oh-my-zsh.

## Switching from Bash

To switch from bash to zsh:

1. Install zsh: `brew install zsh` (macOS) or `apt install zsh` (Linux)
2. Change your default shell: `chsh -s $(which zsh)`
3. Log out and log back in (or start a new terminal session)

Your dotfiles are already configured for both shells, so the transition is seamless!

## Updating Oh My Zsh

Oh My Zsh will prompt you to update periodically, or you can manually update:

```bash
omz update
```

## Troubleshooting

### "command not found: compdef"

This error means oh-my-zsh is not installed. Run:
```bash
cd ~/.dotfiles
./setup.sh
```

### Git aliases not working

Oh My Zsh git plugin provides different aliases than the custom bash ones. See the [git plugin documentation](https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/git) for the full list, or define your own in `~/.zshrc.local`.

### Theme not displaying correctly

Some themes require powerline fonts. Install them:
- macOS: `brew install --cask font-hack-nerd-font`
- Linux: Install fonts-powerline package

See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) for more solutions.

