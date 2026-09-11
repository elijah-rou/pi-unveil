# Standalone skills with optional flow support

Status: accepted for 0.2. Supersedes the skill-activation and context-handling
parts of [Session-scoped guidance](session-state.md).

## Context

The user wants brief grounding in the problem and current system before solution
design. The methods must also work without the extension. Version 0.1 tied native
skill invocation to activation, included tool controls in skill text, and removed
expanded skill bodies from model context to prevent untracked queued activation.
That protected the old contract but prevented genuinely standalone methods.

## Decision

The two skill files own the complete conversational methods, including brief
orientation, explanations, pauses, redirection, and closing within the caller's
scope. Neither names an extension tool or command. Planning begins with a short
problem/success statement and a compact view of relevant components, state, and
dataflow. Deeper exploration follows the user's questions, not a mandatory tour.

Only `/unveil-plan` and `/unveil-understand` activate extension flow support.
Native `/skill:` invocations, including queued ones, pass through without changing
mode, task, or point. Reading a skill file is also ordinary work. An inner skill
can help an active outer task without causing a handoff or restart; its completion
does not mean that the outer task is complete.

The extension reads the same method bodies and adds a separate flow-support
wrapper. That wrapper owns progress/finish tool instructions, the widget, and
outer-task scope. Per-request state revokes only extension-managed guidance after
exit. It never removes skill bodies or suppresses independently requested skills.
The version-1 state schema, bounds, branch restoration, and malformed-state
handling remain unchanged; older saved flows still restore.

## Alternatives and consequences

Keeping optional tool calls in the skills would avoid moving instructions, but
would leave their behavior dependent on which extension tools happen to exist.
Automatically switching out of flow support on an inner skill invocation would
interrupt legitimate helper work. Ignoring skills as control events keeps that
boundary explicit and removes the queued-skill interception code.

Standalone methods depend on normal conversation context; they do not promise a
widget, durable mode state, or guidance reinjection after compaction. With flow
support active, the model still decides when the outer task is complete. Neither
path enforces pauses or proves understanding. Revisit this separation only if a
real user trial exposes an ownership conflict that cannot be resolved within the
outer task's scope.
