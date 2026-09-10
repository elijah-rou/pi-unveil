# pi-unveil

Work through a design or an existing system with Pi, one meaningful step at a
time. Ask questions, inspect the code, change direction, or revisit a decision
before moving on. Ordinary tasks remain autonomous until you explicitly start
Unveil.

Requires upstream Pi 0.85.1 or a compatible release. Tested against 0.85.1.

## Install

```sh
pi install git:github.com/elijah-rou/pi-unveil
```

Run `/reload` in an existing Pi session. For a reproducible installation, append
`@<full-commit-sha>` to the package source. Bootstrap pins a specific commit.

## Start a conversation

```text
/unveil-plan design retries for failed webhook deliveries
/unveil-understand trace how this request reaches the database
/unveil-off
```

Both start commands accept an optional task. Without one, Pi uses the current
task. Start or switch modes while Pi is idle; if a turn is running, stop it first.
The commands begin the conversation immediately.

| Mode | Interaction |
|---|---|
| `unveil-plan` | Explain one consequential choice, show its program shape and tradeoffs, discuss it, and update dependent decisions when the direction changes. |
| `unveil-understand` | Follow a concrete example through actual code, state changes, and failure paths. Distinguish documented rationale from inference. |

A small widget shows the mode, task, and current discussion point. Reply in
ordinary chat: “why?”, “show the caller”, “what fails here?”, “go deeper”, “back
up”, or “continue”. There is no required response format and no quiz. “Back up”
revisits the discussion; it does not undo files or Git history.

The two skills are also available directly:

```text
/skill:unveil-plan design retries
/skill:unveil-understand trace the retry handler
```

They are manual-only skills, so Pi does not discover them as automatic task
methods. Invoke them while idle. Pi's queued steering/follow-up APIs bypass the
normal activation hook; Unveil removes those queued skill instructions from
model context and asks you to retry a start command while idle. They cannot
silently activate or switch the mode.

## Exit and session behavior

`/unveil-off` exits without starting another model turn. The next message follows
the ordinary workflow. As an entire chat message, “continue normally” or “return
to normal” also exits, ignoring case and an optional final period or exclamation
mark. Other requests to stop are handled conversationally by the agent.

The agent is instructed to finish Unveil when the guided task is complete or a
clearly unrelated task begins. That judgment is not an automatic task classifier;
use `/unveil-off` when you want a deterministic exit. Do not use `agent_end` as a
completion signal: an agent also ends a turn when it pauses for your question.

Mode state survives compaction, reload, and resuming the same session. Tree
navigation restores the selected branch's state. New sessions and forks do not
inherit an active mode. There is no project-wide or global mode setting.

The extension supports TUI and RPC sessions using ordinary chat and status APIs.
Print/JSON invocations cannot activate it. It does not build a custom question
interface or require RPC clients to support custom terminal components.

## What it does not enforce

The extension keeps mode guidance available, but the model still chooses the
explanations and discussion points. Pauses are instructions, not an execution
gate. The agent-callable `unveil_progress` tool updates the displayed point or
finishes an active mode; it cannot activate one, approve a decision, or establish
that the user understands the system.

Existing planning, verification, and authorization rules remain in effect.
Understanding mode asks for read-only exploration, but **Unveil is not a sandbox**
and does not block tools. Neither mode changes models, reasoning settings, tool
permissions, or repository files. Planning does not itself authorize
implementation or publication.

Unveil makes no extra model or network requests. Its only stored data is bounded
mode/task/point state in Pi's existing session history. It creates no learning
profile, score, schedule, or separate memory database. Task labels are ordinary
session data: do not put secrets in them.

## Development

```sh
npm ci --ignore-scripts
npm run check
pi -e ./unveil.ts
```

The last command tries the extension without installing it; its start commands
load guidance from the adjacent skill files. Installing the package also exposes
the native `/skill:` entry points.

Tests cover input boundaries, inactive behavior, mode switching, state restoration,
exit handling, queued skill invocations, and real Pi loading and conversation
plumbing with an in-memory fixture provider. No credentials or network access are needed for the tests.
These checks do not establish learning effectiveness or model adherence; use a
real design and code walkthrough to evaluate those with the user.

See [the session-state decision](docs/session-state.md) for ownership and lifecycle
tradeoffs.
