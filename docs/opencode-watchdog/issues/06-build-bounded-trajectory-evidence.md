# 06: Build bounded trajectory evidence

**What to build:** Give each watchdog review a deterministic, privacy-conscious trajectory packet containing enough current evidence to judge obvious mistakes while enforcing a hard serialized prompt bound.

**Blocked by:** 05: Run one silent isolated idle review.

**Status:** ready-for-agent

- [ ] Packets contain bounded original/current real-user scope, latest todos, recent terminal tools, favored failures, final assistant text, compact event-derived change evidence, and the previous accepted concern when present.
- [ ] Reasoning, full conversation history, full file bodies, and full diffs are never collected or sent.
- [ ] Tool output is clearly wrapped as untrusted evidence and canonical serialization uses stable field order and labels.
- [ ] The complete watchdog-controlled user prompt, including wrapper and escaped JSON, never exceeds 16,384 UTF-8 bytes.
- [ ] Quote-heavy, backslash-heavy, control-character, emoji, and multibyte fixtures prove exact byte measurement and deterministic reduction order.
- [ ] Snapshot identity and fact-based evidence identity remain separate; opaque identifier changes alone do not constitute changed evidence.
- [ ] Retained evidence is immutable at claim time and bounded rings, hashes, tombstones, and session-state eviction cannot discard protected work.
- [ ] A positively identified context overflow retries once with a smaller canonical packet in a fresh child under the same lease; the failed child retains no conversation context.
