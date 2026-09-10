# Initial release

## Scope and authority

Build and publish `elijah-rou/pi-unveil` as a public standalone Pi package. Integrate an immutable package commit into bootstrap, then advance the public launcher and workstation snapshot pins. Existing repositories were pulled before edits. Publication of all three repositories is authorized; unrelated changes remain untouched.

## Accepted design

- Separate manual-only `unveil-plan` and `unveil-understand` skills.
- Explicit commands activate one mode for the current task/session. Ordinary work stays autonomous.
- Short guided steps, concrete program behavior and rationale, discussion before advancing, and revisiting decisions. No mandatory quizzes or competence scores.
- The extension owns visible mode/task/point state and re-injects the selected skill's guidance. Skills own the interaction method.
- Default off. Restore the current session branch after reload/resume; new sessions and forks start off. Store only bounded mode/task/point state in Pi's session, not a separate memory system.
- Commands and skill invocations start/switch modes. A progress tool can update a point or finish an active task, never activate a mode. Explicit exit returns to ordinary work.
- No custom questionnaire, enforced checkpoint engine, tool-permission changes, model changes, network calls, or repository mutation by the extension.
- Understanding is read-only guidance, not a sandbox. Existing authorization and verification rules remain authoritative.

## Program shape

- `unveil.ts`: commands, lifecycle hooks, guidance injection, status and progress tool.
- `src/state.ts`: bounded public input and persisted state validation.
- `skills/unveil-{plan,understand}/SKILL.md`: independent interaction methods, loaded from the package rather than duplicated in code.
- `tests/`: contract tests plus installed Pi loader/session integration.

## Slices

| Slice | Evidence | Status |
|---|---|---|
| Package and guided-session runtime | 20 passing tests on Node 26 and 22.18; strict typecheck; isolated distributable loading; real Pi 0.85.1 compaction and queue paths | complete |
| Skills and public documentation | Two source reviews; clarified discussion pauses, existing authorization, failure paths, and unavailable progress controls | complete |
| Publication and bootstrap integration | Public package and local installation pinned at `60f267d`; bootstrap runtime `b85c3cd`, launcher `25ff785`, workstation pin `95e302c`; both default repository validators passed | complete |

## Resume

Implementation and publication are complete. The public package's CI passed on Linux and macOS with Node 22 and 24. Bootstrap and workstation validators passed using their CI-compatible Node 24.18 and Python 3.13 runtimes. Workstation validation also required a separate one-line fixture fix to canonicalize temporary paths on macOS; installer behavior was unchanged.

A source review identified native queued skills bypassing input hooks; per-request context now strips their instruction bodies, preserves inactive state, and revokes guidance even before any activation. Real Pi steering and follow-up regression cases pass. Language-server initialization failed to locate TypeScript from the parent workspace; the package's strict TypeScript compiler check passes. No published learning-efficacy claim: a real user trial is still needed.
