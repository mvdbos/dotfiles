# Design It Twice

When the user wants alternative interfaces for a chosen deepening candidate, develop distinct designs sequentially, then recommend one. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best. The main agent performs all design and comparison.

Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Write a user-facing explanation of the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Show this to the user, then proceed to Step 2. If a missing requirement prevents meaningful alternatives, ask first.

### 2. Develop distinct alternatives sequentially

Develop alternatives with materially different interfaces, rather than cosmetic variations.

Use the same evidence for each design: file paths, coupling, dependency category from [DEEPENING.md](DEEPENING.md), and what sits behind the seam. Apply these different constraints in order:

- Minimal interface: maximize leverage per entry point.
- Flexibility: support the established use cases and justified extensions.
- Common caller: make the default case trivial.
- When cross-seam dependencies warrant it, also explore ports and adapters.

Use both [SKILL.md](SKILL.md) vocabulary and the project's `CONTEXT.md` vocabulary consistently.

For each design, write:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs: where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.
