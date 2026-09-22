# Dotfiles Context

This repository defines the user's reproducible command-line and agent environment.

## Language

**OpenCode harness**:
The reproducible collection of capabilities that defines the user's global OpenCode environment.
_Avoid_: OpenCode setup, agent config

**Workflow skill suite**:
The coherent set of locally maintained workflows that forms the skill layer of the OpenCode harness.
_Avoid_: Dotagents skills, external skills

**External skill**:
A skill available to OpenCode but owned independently of the OpenCode harness.
_Avoid_: Harness skill, bundled skill
