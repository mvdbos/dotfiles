# Directory Aliases

This directory is for creating symbolic links to directories you frequently access.

## Usage

Create a symlink to a directory you want to bookmark:

```bash
ln -s /path/to/your/project ~/.config/dir_aliases/myproject
```

Then you can quickly navigate to it using the `cd` command:

```bash
cd myproject
```

The `cdbm` function (defined in `shell/.config/shell/functions`) will resolve these bookmarks and automatically list the directory contents.

## Example

```bash
# Create bookmarks
ln -s ~/Documents/work ~/.config/dir_aliases/work
ln -s ~/Projects/personal ~/.config/dir_aliases/personal

# Navigate using bookmarks
cd work      # Goes to ~/Documents/work
cd personal  # Goes to ~/Projects/personal
```
