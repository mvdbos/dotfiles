# Skill mechanics

The skill-specific branch of [`writing-for-agents`](SKILL.md): what changes when the document is a skill (frontmatter, the invocation choice, and router skills). Everything else about writing it is the universal reference in `SKILL.md`.

## Invocation

Conceptually, invocation can start with a user request or with the model selecting a skill. Discovery and access depend on the harness; these are not universal frontmatter guarantees.

- A **model-discoverable** skill needs a description naming when to use it and what it produces. The description is its context pointer; other workflows can load the skill when access is permitted.
- A **user-oriented** workflow may primarily be requested by name. Keep a useful description; do not assume that intended usage removes it from model discovery.

### OpenCode behavior

The [OpenCode skill documentation](https://opencode.ai/docs/skills/#write-frontmatter) recognizes `name`, `description`, `license`, `compatibility`, and `metadata`. Unknown fields are ignored. Therefore `disable-model-invocation: true` alone neither hides a skill nor prevents model invocation in OpenCode. Retain it when useful for other harnesses, but do not rely on it here.

OpenCode skill permissions control access: `deny` hides a skill from the agent and rejects access; `ask` requests approval; `allow` permits loading. A cross-skill instruction uses `skill` with the target name and remains subject to those permissions. If installed behavior differs from the documentation, inspect the installed version before making a harness-specific claim. Documentation correction alone does not require permission changes or new commands.

Shared material without a useful standalone trigger can live in a plain reference file. Each caller names its concrete path and the condition for reading it. This avoids a redundant discoverable skill; it is not an access-control boundary.

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in `SKILL.md`): split off a model-invoked skill when you have a distinct leading word that should trigger it on its own (a trigger word you actually use in your prompts), or another skill must reach it. You pay context load for the new always-loaded description, so that independent reach has to be worth it.

## Router skills

A **router skill** names workflows and the conditions for selecting them. Use one only when it materially helps users find workflows. In OpenCode it can instruct the model to load a permitted skill by name; `disable-model-invocation` on the target does not block this. Do not assume routing creates hidden or user-only entry points.
