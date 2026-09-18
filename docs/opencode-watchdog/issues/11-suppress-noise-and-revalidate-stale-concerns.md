# 11: Suppress noise and revalidate stale concerns

**What to build:** Admit only concrete, current, independently useful watchdog findings and safely reassess potentially relevant findings produced for an older user turn.

**Blocked by:** 07: Deliver guarded idle concerns; 08: Run cadence reviews under a global lease; 10: Preserve cadence through foreign continuation.

**Status:** ready-for-agent

- [ ] Blank, generic, content-free, malformed, extra-key, and oversized findings are discarded without affecting main-agent progress.
- [ ] Concern identity uses normalized category/message content, while changed-evidence decisions use the exact final packet facts sent to the critic.
- [ ] Duplicate categories/messages require both the configured new-tool cooldown and changed evidence before another critic judgment can become deliverable.
- [ ] Addressed findings remain suppressed until new evidence exists; no semantic acknowledgement detector is introduced.
- [ ] A schema-valid cadence or idle result from an older real-user epoch settles only its original accounting and never displays directly or consumes current delivery budget.
- [ ] One otherwise valid stale concern may create exactly one current-evidence revalidation; stale `ok`, malformed output, cancellation, and stale revalidation cannot chain further.
- [ ] Revalidation consumes no cadence count and advances no sequence/change baseline.
- [ ] Repeated provider/session failures open a bounded circuit breaker while preserving fail-open main-agent behavior.
- [ ] Race tests cover newer prompts during inference, idle during cadence, predecessor success/failure, delayed toast callbacks, and replacement advisories.
