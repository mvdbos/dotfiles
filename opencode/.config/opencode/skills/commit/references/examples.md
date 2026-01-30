# Commit Message Examples

This file contains examples of well-formatted commit messages following the repository standards.

## Good Example: Refactoring

```
Refactor path finding to use executable location

Simplify path resolution by using os.Executable() instead of checking
multiple CWD paths. Reduces complexity and improves startup performance.
```

**Note:** This focuses on the primary refactoring goal, not every changed function or incidental fixes.

## Good Example: Bug Fix

```
Fix null pointer in user validation

The user validation function was not checking for nil pointers before
accessing user properties, causing crashes during edge cases where user
data was incomplete.
```

## Good Example: New Feature

```
Add support for custom configuration files

Enable users to specify custom config file paths via --config flag.
Previously the application only looked in default system locations,
limiting flexibility for containerized deployments.
```

## Good Example: Update/Enhancement

```
Update database query performance for large datasets

Optimize the search query by adding composite index on user_id and
timestamp fields. Reduces query time from 2s to 200ms for tables with
over 1M records.
```

## Bad Examples (What to Avoid)

### Too Generic
```
Update files
```
**Problem:** Doesn't explain what was updated or why.

### Includes Conversation References
```
Fix bug as discussed in the meeting
```
**Problem:** References external context not in the repository.

### Lists Every Detail
```
Fix bug

Changed foo.js line 42, updated bar.py function calculateTotal(),
modified test file test_bar.py, updated documentation in README.md
section 3.2, and fixed typo in comments.
```
**Problem:** Lists file-by-file changes instead of summarizing the impact.

### Uses Emojis or Unicode
```
✨ Add new feature 🎉
```
**Problem:** Non-ASCII characters violate the commit message format rules.

### Work-in-Progress
```
WIP: trying to fix the thing
```
**Problem:** Generic and indicates incomplete work that shouldn't be committed yet.

## Format Reminders

- **Title**: Max 72 characters, capitalized verb, imperative mood, ASCII only
- **Blank line**: MANDATORY between title and body
- **Body**: Focus on WHY, not WHAT. Wrap at 72 characters. Be concise.
