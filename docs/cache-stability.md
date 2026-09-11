# Cache-stable guidance delivery

Status: accepted for 0.2.1. Revises the delivery mechanism in
[Standalone skills with optional flow support](standalone-skills.md), not its
ownership or activation contract.

## Problem and evidence

Unveil 0.2 placed the selected method, task, and current point in the system
prompt. Native Codex serialization confirmed that changing only the point changed
`instructions` ahead of otherwise unchanged history. Activation, switching, and
exit also changed it. The per-request timestamp was not serialized by Codex.

Repeated off/context messages were not retained, so their input position also
moved between requests. Increasing retention cannot repair a changed prefix.
Request-shape evidence does not establish actual charges or attribute every
observed cache miss to Unveil.

## Decision

Keep one short system bridge constant in unused, active, and off states. Deliver
the selected method and flow wrapper as a retained `pi-unveil-guidance` custom
message through `before_agent_start`. Its text starts with `[Unveil flow control]`.
The latest control and subsequent successful progress results determine the outer
flow. Standalone skills remain independent and their messages are untouched.

A control's version-1 details contain a bounded version-1 state snapshot and a
SHA-256 `methodHash`. Compare session, mode, task, and method hash when deciding
whether another control is needed; point changes already have retained tool
results. A successful finish result itself supplies the exit. Failed results or
malformed metadata cannot stand in for a control. Historical messages are never
rewritten on state or method changes.

## Compaction boundary

Compaction can run between tool calls. Appending a regular custom message during
that event is not sufficient: Pi may queue it until a later turn, or place it
between a tool call and its result. Instead, a missing method is recorded once in
a `pi-unveil-checkpoint` custom entry. Version 1 contains `checkpointId`,
`retainedMessageCount`, and the complete frozen guidance message. Guidance content
is bounded to 24,000 characters, IDs to 128, and the retained count to the integer
range 1–100,000. These supplement the unchanged version-1 mode-state format.

The context hook projects this snapshot immediately after the checkpoint's
original retained messages and before later messages. The position and content
remain fixed on every replay, preserving the new prefix while leaving tool-call
and result pairs together. Recovery follows older retained controls so it cannot
be overridden by stale mode information in the kept tail. Overflow retries omit
a terminal failed or truncated response after the compaction event. The frozen
count excludes that response, keeping recovery ahead of the retry and its tool
results. If resume restores the failed entry, it follows the same frozen recovery
position; Unveil does not remove or rewrite it. Exposed metadata is copied, not
shared with session-owned records.

The current retained checkpoint is authoritative. Pi 0.85.1 can report an older
compaction event entry when summary strings are identical. Recovery therefore
uses `buildContextEntries()` rather than that event's entry ID. Repeated events
reuse the existing snapshot. If the method remains retained, no snapshot is made.

## Alternatives and limits

Removing only the point from the system prompt would leave mode/task changes
cache-hostile. Re-injecting the full method at each request tail would repeatedly
resend it uncached and shift its position. Preloading every method in the system
prompt would add unrelated instructions to ordinary work. The retained-message
and fixed-checkpoint approach preserves explicit opt-in without patching Pi.

An update/reload, compaction, tree navigation, or changes from another extension
can legitimately change a request prefix. Provider caching is not guaranteed.
Tests check native serialized prefixes, retained guidance, session isolation,
and threshold/overflow mid-run recovery, including truncated responses. They do
not claim measured savings or learning outcomes.
