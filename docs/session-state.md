# Session-scoped guidance

Status: initial-release decision. Skill activation and context handling are
superseded by [Standalone skills with optional flow support](standalone-skills.md).
The version-1 persisted state format is unchanged.

## Context and constraints

Unveil should make selected tasks interactive without changing ordinary work.
Planning and understanding need separate methods, but share mode controls and
session lifecycle behavior. Guidance must remain available after compaction.
There is no requirement for a learning database or enforced approval engine.

## Decision

Keep the methods in two manual-only skills. The extension reads their bodies
from its own package and appends the selected method to the existing system
prompt before a user turn. Do not maintain another copy of either method in code.

Persist state as Pi custom entries named `pi-unveil-state`. Version 1 records
contain `version`, `sessionId`, and `mode`. Active `plan` or `understand` records
also contain `task` and `point`; `off` records contain neither. Task input is
limited to 1000 characters, points to 160, and session IDs to 128. Length checks
use JavaScript string length. Duplicate state updates do not append new entries.

Restore only the latest matching entry on the current branch. Malformed or
unknown-version records disable guidance rather than resurrecting earlier active
state. A record from another session cannot activate the mode in a fork. Pi owns
session storage, compaction, and branching; Unveil owns only its namespaced data.
Custom entries are not model context, so guidance is explicitly re-injected.

Mode changes require explicit commands or native skill invocation. The progress
tool cannot activate a mode; it can update a discussion point or finish an active
task. Do not infer completion from an assistant turn ending. Explicit off state
also supplies a short instruction revoking earlier Unveil guidance in the chat,
even when no earlier state record exists.

Pi 0.85.1's queued steering/follow-up APIs expand native skills without an input
event. A per-request context hook replaces expanded Unveil skill bodies with
invocation records and supplies the current runtime state. Untracked invocations
produce an off record, never activation. This does not rewrite session history.
A finish tool result also takes effect through that hook within the same agent
run, rather than waiting for another user prompt.

## Alternatives and consequences

Skills alone would be smaller but would not provide visible mode state or
re-injection after compaction. A new project setting would make the mode broader
and longer-lived than requested. A separate memory store would duplicate Pi's
session ownership. Enforced checkpoints would add tool interception and authority
questions before there is evidence they are needed.

The model remains responsible for the quality of explanations, conversational
pauses, and recognizing task completion. This is not a read-only sandbox or proof
of understanding. Future state-format changes must validate and migrate records
explicitly or disable unsupported records safely. Revisit the design if user
trials expose forgotten exits, unreliable pauses, or a concrete need for controls
beyond ordinary chat.
