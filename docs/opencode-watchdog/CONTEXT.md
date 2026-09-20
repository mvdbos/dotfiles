# Watchdog

An OpenCode server plugin that reviews a root agent session's trajectory and, through a hidden tool-less critic, raises evidence-backed concerns. This glossary defines the vocabulary shared by the plugin, its plan, and its docs.

## Review

**Watchdog**:
The subsystem that reviews a root session's trajectory and delivers concerns.
_Avoid_: supervisor, monitor, guard

**Critic**:
The hidden `watchdog-critic` child session that reads one observation packet and returns `ok` or one concern.
_Avoid_: judge, reviewer, supervisor

**Observation packet**:
The bounded, untrusted evidence a critic receives: task text, todos, recent tools, failures, changes, and any previous or revalidation concern.
_Avoid_: prompt, context, snapshot

**Check**:
One critic invocation. Its trigger makes it a cadence, idle, or revalidation check.
_Avoid_: review, judge run

**Cadence check**:
A check triggered after a configured number of significant tool calls.

**Idle check**:
A check triggered when a root session becomes idle.

**Revalidation**:
A one-hop re-check of a stale concern against current evidence. It never chains.
_Avoid_: retry, recheck

**Concern**:
A critic finding with severity, category, message, and supporting evidence. Only accepted concerns are delivered.
_Avoid_: finding, warning, issue

**Significant tool call**:
A terminal tool call that counts toward the cadence and the observation packet, excluding watchdog-control and human-synchronization tools.
_Avoid_: tool event, action

## Turns

**Real user turn**:
A root user message not written by the watchdog or a recognized foreign continuation. Only real turns define task scope, reset budgets, and own a turn epoch.
_Avoid_: user prompt, human turn

**Foreign continuation**:
An untagged root continuation written by another plugin, matched by configured patterns. It preserves the current turn epoch and budgets.
_Avoid_: goal message, external prompt

## Feedback

**Advisory**:
An accepted concern retained for delivery as an immutable tool-result trailer or guarded idle follow-up.
_Avoid_: annotation, steering message

**Idle follow-up**:
A marker-tagged root prompt that makes the main agent reconsider an accepted concern before stopping.
_Avoid_: continuation prompt, watchdog message

**Activity toast**:
A transient status notice that a cadence check is still running longer than the visibility threshold. Diagnostic; shown only in diagnostic mode.
_Avoid_: status toast, info toast

## Configuration

**Diagnostic mode**:
The `debug` config flag. When on, it enables the activity toast, per-check telemetry, and routine lifecycle logs; failure logs always emit.
_Avoid_: verbose mode, debug logging, trace
