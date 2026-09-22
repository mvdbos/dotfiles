---
name: to-spec
description: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed."
disable-model-invocation: true
---

Synthesize the current conversation and codebase understanding into a published spec. Ask only when missing information prevents the requested output; do not reopen settled decisions.

Read `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` before publishing. If required configuration is missing, report the publication blocker and direct the user to `setup-matt-pocock-skills`.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Capture agreed testing decisions and seams. Prefer existing high-level seams when describing proposals, but mark proposals and unresolved choices separately from settled decisions. No reconfirmation is needed for agreed seams.

3. Write the spec using the template below, then publish it using `docs/agents/issue-tracker.md`. Cover each distinct agreed behavior. Expose unresolved requirements instead of inventing completeness. Apply `ready-for-agent` only if no unresolved behavior materially blocks autonomous implementation; otherwise label according to the configured triage vocabulary and state the blockers. Report the published location, or the specific publication blocker.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A numbered list covering distinct agreed behaviors. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

Avoid duplicate stories added only for length; record unresolved requirements separately.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Unresolved Decisions

Open requirements and testing choices, their consequences, and which ones block implementation. Keep these separate from agreed decisions.

## Further Notes

Any further notes about the feature.

</spec-template>
