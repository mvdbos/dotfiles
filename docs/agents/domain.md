# Domain Docs

How engineering skills consume this repo's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repo root, when present.
- Relevant scoped context documents under `docs/`, including `docs/opencode-watchdog/CONTEXT.md`.
- ADRs under `docs/adr/` that touch the area being changed.

If these files do not exist, proceed silently. Domain-modeling workflows create them lazily when terms or decisions are resolved.

## Layout

This repo uses a single-context layout:

- `CONTEXT.md` contains the repository-wide glossary and domain model.
- `docs/adr/` contains architectural decisions.
- Scoped context documents under `docs/` may supplement the root context for established subsystems.

## Vocabulary

Use terms defined in the relevant context document. Do not replace explicit domain terms with synonyms. If a needed concept is absent, reconsider the terminology or record the gap for domain modeling.

## ADR conflicts

Surface conflicts with an existing ADR explicitly rather than silently overriding the decision.
