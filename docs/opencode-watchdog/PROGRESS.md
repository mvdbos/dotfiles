# Watchdog implementation progress

Goal: implement all issues in `docs/opencode-watchdog/issues/` in order.
Plan of record: `docs/research/opencode-watchdog-plugin-plan.md`.

## Status

| Ticket | Status | Evidence |
|---|---|---|
| 01 prove isolated critic execution | done | `watchdog/integration/critic-probe.integration.test.ts` (4 pass): parent-linked child, captured critic request (explicit model, no tools/tool_choice/response_format, 256-token cap, thinking disabled), merged config keeps `hidden`/deny permissions, timeout aborts server-side before replacement, child deleted. Fallback recorded: `steps: 1` is omitted because it makes OpenCode inject a MAXIMUM STEPS REACHED notice into every critic request; per-request tool deny plus the 256-token cap are the termination boundary. |
| 02 prove prefix-safe request-local feedback | done | `watchdog/integration/midrun-feedback.integration.test.ts` (2 pass): advisory reaches next request, repeats byte-identically at same boundary, newer tool results stay clean, historical prefix bytes unchanged, stored messages and compaction requests/summaries never see advisory. Decision recorded in `watchdog/probe-outcomes.ts` (`MID_RUN_DELIVERY_ENABLED = true`). |
| 03 prove visible idle and goal arbitration | done | `watchdog/integration/idle-goal.integration.test.ts` (5 pass, installed goal-plugin 0.1.49): active and limit continuation fixtures match built-ins on both idle event forms; ordinary timing cancels watchdog admission (`prompted=0`); detached prompt wakes one response and preserves agent/model; critic child defers continuation and deletion releases it; root advisory tokens count while critic-child usage does not. `watchdog/integration/idle-feedback-tui.integration.test.ts` (TUI attach): non-synthetic marker text renders, synthetic stays hidden, info/warning/error toasts render without transcript messages. |
| 04 protect real-user message targeting | done (core) | `plugin-generated-user/helpers.ts` + 18 unit tests; `plugin-generated-user/config.ts` shared loader; `todo-reconcile` `lastUserMessage(messages, isEligible)` + plugin wiring + 3 lifecycle tests; typecheck green. |
| 05 silent isolated idle review | done | `plugins/watchdog.ts` + `watchdog/plugin.ts` production wiring; `watchdog/integration/watchdog.integration.test.ts` (real OpenCode, 2 pass: isolated critic child, 256-token cap, no tools/structured output, no feedback on ok, child cleanup; invalid config disables with bounded reason). Plugin unit tests in `watchdog/plugin.test.ts`. |
| 06 bounded trajectory evidence | done | `watchdog/packet.ts` + `packet.test.ts` (14 pass); context-overflow retry via `minimalPrompt` in `critic.ts`; `watchdog/collect.ts` + tests. |
| 07 guarded idle concerns | done | delivery budget/noise gates + continuation claim in `plugin.ts`; `guarded-idle.integration.test.ts` (visible marker follow-up, no recursion). |
| 08 cadence under global lease | done | `watchdog/scheduler.ts` (`WatchdogLease` on `watchdog-critic`, non-blocking `tryAcquire`, `ExploreGate`, fairness helpers) + cadence claims; `guarded-idle.integration.test.ts` (request-local advisory after five tools) and plugin unit tests. |
| 09 yield capacity to exploration | done | explore admission/end detection in `plugin.ts`; preemption aborts server-side, defers ownership, re-claims cadence; plugin unit test proves resume; `subagent-controls` suite unchanged. |
| 10 foreign continuation cadence | done | shared classifier + `applyForeignContinuation`/`deferClaim`; foreign cancels idle only, preserves cadence; goal-plugin integration in `idle-goal.integration.test.ts`. |
| 11 suppress noise / revalidate | done | `noise.ts` gates, evidence-fingerprint change detection, stale result settles accounting without budget/delivery, one-hop revalidation, circuit breaker; plugin unit tests. |
| 12 cadence delivery at safe boundaries | done | `feedback.ts` transform + compaction guard (significant tools only), enabled by `MID_RUN_DELIVERY_ENABLED`; `composition.test.ts` runs before/after strip/image plugins; production integration proves non-persistence. |
| 13 evaluation and enablement | done (decision: enabled on the required 4B) | `watchdog/evaluation/corpus.ts` (21 positive + 44 negative frozen fixtures covering every concern class plus injection/revalidation and production-scale packets up to ~11 KiB), `watchdog/evaluation/runner.ts` (detection TPR/FPR, category precision, duplicates/latency/byte metrics, mode comparison, acceptance gates, injection FPs reported separately), `runner.test.ts`. Two consecutive live runs with the required `omlx/Qwen3.5-4B-oQ4e-mtp` through a real OpenCode fixture: **TPR 0.762 / FPR 0.048 and TPR 0.667 / FPR 0.048**, malformed 0.000 (now counted from raw critic output), median latency ~0.5 s, max prompt 10,721 bytes, recorded in `docs/opencode-watchdog/live-evaluation.json`. Prompt-injection fixtures are excluded from the FPR gate by explicit product decision (user is not concerned about injection). `watchdog.json` ships `enabled: true` with the 4B model; `probe-outcomes.ts` records `EVALUATION_PASSED = true`. The winning prompt adds explicit positive-detection rules, anti-FP rules (balanced tail), and exact-key JSON examples; the `steps: 1` agent setting stays removed. Follow-up hardening: the parser extracts the first JSON object (fences/prose tolerated) and ignores benign extra keys while keeping enum/length/content gates; cadence claims never start while a check is in flight and are reclaimed after completion when new tools justify one. |

## Implemented modules

- `plugin-generated-user/helpers.ts`: three-way real/watchdog/foreign classification, version-pinned goal-plugin 0.1.49 built-ins, `extend`/`replace` validation, fail-open misses, drift detection.
- `plugin-generated-user/config.ts`: shared `loadUserClassifierConfig()` reading `watchdog.json` (env override `OPENCODE_WATCHDOG_CONFIG`).
- `watchdog/prompt.ts`: byte-stable critic system prompt, user wrapper, output schema, advisory builders, metadata envelope.
- `watchdog/config.ts`: strict `watchdog.json` parsing, defaults, disable reasons, critic agent definition.
- `watchdog/noise.ts`: critic output extraction (first balanced JSON object, fences/prose wrapped, benign extra keys ignored), strict semantic gates (status/severity/category/message bounds, content-free rejection), concern identity, two-slot delivery budget.
- `watchdog/critic.ts`: ephemeral child runner with tool deny map, timeout, abort-before-delete, context-overflow retry.
- `watchdog/packet.ts`: ClaimedEvidence/WatchdogPacket types, deterministic bounding and reduction, exact 16,384-byte UTF-8 cap, evidence fingerprints, snapshot keys.
- `watchdog/collect.ts`: significant-tool classifier, terminal tool/failure/change extraction, assistant text, todos.
- `watchdog/state.ts`: bounded per-root state, ring/LRU, real/watchdog/foreign turn transitions, cadence/idle/revalidation claims, deferred cadence union, success/failure settlement, CAS settlement winner.
- `watchdog/probe-outcomes.ts`: deterministic probe decisions.
- `watchdog/integration/harness.ts`: isolated HOME/XDG fixture, scripted mock OpenAI server (text + tool calls + usage), real OpenCode spawn, log capture, plugin-load shim, TUI attach, goal-plugin cache seeding.
- `watchdog/integration/probe-plugin.ts`, `feedback-probe-plugin.ts`, `idle-goal-probe-plugin.ts`: probe-only fixture wiring (not loaded by production config).
- `todo-reconcile/src/lifecycle.ts`: eligibility predicate; projection picks newest eligible real user.

## Design notes for the remaining plugin wiring

- `watchdog/scheduler.ts`: `WatchdogLease` wrapping `SubagentAdmissionQueue` (`resource: "watchdog-critic"`, `timeoutMs: 1` for a non-blocking tryAcquire), per-root `SessionState` registry (max 100, protected states never evicted), admission order idle > revalidation > cadence, fairness rotation, 750 ms activity toast tied to checkID, explore preemption (abort server-side, delete, then release; uncertain abort keeps lease).
- `watchdog/feedback.ts`: `experimental.session.compacting` arms one-shot per-session skip; `experimental.chat.messages.transform` applies/repeats the advisory byte-identically at the installed tool part; idle `session.prompt` with non-synthetic marker text + `watchdogMetadata`; toast state machine `pending/delivered/failed` with one retry after known failure.
- `watchdog/plugin.ts`: hook composition (config agent injection, chat.params 256 cap gated on registered critic child, chat.message classification, event tree, tool.execute.before/after, transforms, dispose), circuit breaker, stale revalidation hop=1.
- `plugins/watchdog.ts`: re-export only. `watchdog.json`: disabled by default until ticket 13; `midRunDelivery` follows `probe-outcomes.ts`.

## Next steps

- Watchdog is enabled with the required 4B critic (TPR 0.67-0.76 / FPR 0.048 on the frozen corpus, injection excluded by product decision). Monitor live noise; rerun `WATCHDOG_LIVE=1 bun test ./watchdog/evaluation/live.integration.test.ts` after prompt/model changes and compare `docs/opencode-watchdog/live-evaluation.json`.
- Optional 4B precision levers not yet implemented: deterministic pre-gates (skip critic calls with no completion claim/failure/todo mismatch), a deterministic missing-verification/repeated-failure detector, a second self-check pass for accepted concerns, lower `top_p`/`top_k` decoding, and a plain-language packet summary field.
- Cross-process exploration contention remains an accepted, unmeasured MVP risk (ticket 09); measure only if it causes real contention.
- Run the existing suites after any future change: `todo-reconcile` (`bun test`, 46 pass incl. real-OpenCode integration), `subagent-controls` (31), `async-reasoning-titles` hermetic (57), `image-display-annotation`/`image-preview` (26), `ds4-stats` (28 + 4 component), and `watchdog` (hermetic + real-OpenCode + TUI).
