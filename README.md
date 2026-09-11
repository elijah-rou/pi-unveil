# pi-unveil

Work through a design or an existing system with Pi, one meaningful step at a
time. Ask questions, inspect the code, change direction, or revisit a decision
before moving on. Use the two skills on their own, or add the extension's visible
flow controls and session restoration. Ordinary tasks remain autonomous unless
you explicitly request guided work.

Requires upstream Pi 0.85.1 or a compatible release. Tested against 0.85.1.

## Install

```sh
pi install git:github.com/elijah-rou/pi-unveil
```

Run `/reload` in an existing Pi session. For a reproducible installation, append
`@<full-commit-sha>` to the package source. Bootstrap pins a specific commit.

## Start facilitated guidance

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
| `unveil-plan` | Briefly establish the problem and current components/dataflow, then discuss consequential choices, program shape, and tradeoffs one at a time. Update dependent decisions when the direction changes. |
| `unveil-understand` | Follow a concrete example through actual code, state changes, and failure paths. Distinguish documented rationale from inference. |

A small widget shows the mode, task, and current discussion point. Reply in
ordinary chat: “why?”, “show the caller”, “what fails here?”, “go deeper”, “back
up”, or “continue”. There is no required response format and no quiz. “Back up”
revisits the discussion; it does not undo files or Git history.

## Use the skills independently

These commands load the standalone conversational methods, not extension modes:

```text
/skill:unveil-plan design retries
/skill:unveil-understand trace the retry handler
```

They are manual-only skills, so Pi does not select them automatically. The skill
text has no dependency on extension tools, commands, or state. Each opening is
brief: a short problem/question statement and a compact picture of the relevant
components, state, and dataflow, with room for questions before going deeper.

With the extension installed but inactive, `/skill:` still runs independently:
no widget, activation, or saved flow state. If flow support is already active,
skill invocations and file reads are ordinary inner work. They do not restart,
switch, or finish the outer flow, and their content passes through unchanged.
This also applies to queued steering and follow-up skill invocations. Completing
an inner walkthrough returns to the outer task.

To load only the skills, use this entry in your existing Pi `packages` array:

```json
{
  "source": "git:github.com/elijah-rou/pi-unveil",
  "extensions": []
}
```

Other skill-capable agents can load the directories under `skills/` using their
own discovery mechanism. No TypeScript extension is needed to use the methods.

In 0.1, native `/skill:` commands activated the extension. Since 0.2, only
`/unveil-plan` and `/unveil-understand` do that. Existing version-1 session state
still restores; use `/unveil-off` to end a previously activated flow.

## Exit and session behavior

`/unveil-off` ends extension-managed guidance without starting another model
turn. It does not disable independently requested skills. As an entire chat
message, “continue normally” or “return to normal” also exits an active flow,
ignoring case and an optional final period or exclamation mark. Other stop
requests are handled conversationally by the agent. Standalone skills end through
ordinary conversation, without needing an extension command.

The agent is instructed to finish flow support when the outer guided task is complete or a
clearly unrelated task begins. That judgment is not an automatic task classifier;
use `/unveil-off` when you want a deterministic exit. Do not use `agent_end` as a
completion signal: an agent also ends a turn when it pauses for your question.

Mode state survives compaction, reload, and resuming the same session. Tree
navigation restores the selected branch's state. New sessions and forks do not
inherit an active mode. There is no project-wide or global mode setting.

The extension supports TUI and RPC sessions using ordinary chat and status APIs.
Print/JSON invocations cannot activate flow support; standalone skills remain
ordinary prompts. The extension does not build a custom question
interface or require RPC clients to support custom terminal components.

## What it does not enforce

The extension keeps mode guidance available, but the model still chooses the
explanations and discussion points. Pauses are instructions, not an execution
gate. The agent-callable `unveil_progress` tool updates the displayed point or
finishes the outer guided task; inner skill completion does neither. The tool
cannot activate a mode, approve a decision, or establish
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
exit handling, and inner/queued skill calls. Real Pi tests run the standalone skills
both with and without the extension and exercise flow controls with an in-memory
fixture provider. No credentials or network access are needed for the tests.
These checks do not establish learning effectiveness or model adherence; use a
real design and code walkthrough to evaluate those with the user.

See [the standalone-skill decision](docs/standalone-skills.md) for the current
ownership boundary and [the original session-state decision](docs/session-state.md)
for persistence details.
