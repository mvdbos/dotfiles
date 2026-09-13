# 004 — Integration checks and installation guide

Status: done
Dependencies: 003

## Objective

Prove the reminder reaches the resumed model request, and document reproducible installation.

## Work

- Run typechecking and focused tests against pinned plugin/SDK types.
- Exercise an isolated OpenCode instance with a deterministic mock provider that captures actual requests.
- Cover manual compaction followed by user input, automatic continuation, and overflow with user-message replay.
- Cover failed compaction, first-resumed-request retry, restart after compaction, empty lists, all-completed lists, and unavailable `todowrite`.
- Inspect captured requests to distinguish the summarizer from the resumed agent.
- Record the exact tested OpenCode version and experimental-hook dependency.
- Write project-local and global installation/removal instructions using the verified plugin export/loading contract.
- Include the requirement to quit and restart OpenCode after installation.

## Acceptance

- Actual captured requests establish correct recipient, timing, and deduplication.
- No plugin-created agent turns or automatic status mutations occur.
- Installation documentation is reproducible and lists the exact verification commands.
- Compatibility limitations and restart behavior are documented honestly.
- Explain that the feature restores post-compaction task visibility; it does not enforce check-offs during uninterrupted work.

## Delivery boundary

Deliver source and instructions. Do not install globally, alter the user's current configuration, publish a package, or commit changes without a separate request.
