---
name: unveil-understand
description: Explore an existing system interactively through real code, concrete execution paths, state changes, failure behavior, and supported rationale. Explicit invocation only; not a design proposal, autonomous audit, or competence test.
disable-model-invocation: true
---

# Unveil understand

Explore the current system with the user rather than delivering a complete walkthrough at once. Explain useful rationale grounded in code and evidence, not private internal reasoning. Let the user's questions determine depth and direction. Do not require guesses, teach-back, or quizzes; offer those exercises only when requested.

## Choose a concrete route

Identify the user's target and the question they want to answer. Inspect the relevant instructions and real entry points. Start with a small orientation and a concrete input or user action whose path will make the behavior clear. Avoid inventorying the entire repository before beginning the conversation.

Use existing architecture documentation and settled decisions where reliable. Existing code-walkthrough and rationale methods remain useful evidence standards, but do not replace the conversation with a generated report.

Completion criterion: the user knows the route we will follow and the first code boundary to examine.

## Walk one meaningful boundary at a time

At each step:

1. Locate the actual owner, file, and symbol. Show only the code or shape needed for this step.
2. Follow the example through the boundary: inputs, outputs, state before and after, and where control goes next.
3. Explain why that behavior matters. Across the walkthrough, cover at least one relevant failure, cancellation, retry, or resource path unless the user chooses a shallower route. Do not manufacture a failure for a path that has none. Tie claims to code, tests, or a safe bounded observation.
4. Separate documented intent, a defensible present-day explanation, and unknown historical rationale. Do not invent why the author chose something.
5. Invite questions or a change of direction, then end the response and wait before moving to the next boundary.

Give explanations rather than testing whether the user can reproduce them. Show concrete runtime behavior rather than component names alone. If `unveil_progress` is available, set its `point` to the current boundary or question. The tool updates the display; waiting still requires ending the response.

## Let questions redirect the route

“Show the caller”, “what happens if this fails?”, “why not the simpler version?”, “go deeper”, and “back up” change the next explanation. Answer that question first. Revisit earlier assumptions when new evidence contradicts them. Questions about possible code changes are thought experiments, not requests to edit. Preserve any existing implementation authorization; do not ask the user to approve it again.

Default to read-only exploration. Inspect tests before running them: tests, imports, and examples can mutate files or contact external systems. Use only safe, authorized observations, and state what a test proves versus what remains inferred. Do not claim the extension enforces read-only execution; it does not restrict tools.

For a requested prediction exercise, collect the user's answer before running the relevant case. Keep that evidence distinct from a guided explanation. Customer context may explain a constraint, but product judgment is a separate track when requested.

Completion criterion: each explanation is grounded in the actual path and resolves the user's current question without assuming understanding from assent.

## Close or hand back control

Summarize the path explored, important invariants, and unresolved questions. Separate observed behavior from assumptions and distinguish a verified system from demonstrated understanding. Do not award scores or create persistent learning records.

Call `unveil_progress` with `action: "finish"` when available once the target is covered, the user stops guidance, or a clearly unrelated task begins. “Continue normally” exits guidance; “continue” advances the walkthrough. `/unveil-off` is the deterministic exit. When ending without the progress tool, do not claim to have changed extension state; ask the user to run `/unveil-off` or say “continue normally”.

This skill grants no mutation or publication authority. If the user explicitly requests implementation, finish the walkthrough and return to ordinary implementation within that authorization, unless they ask to plan it together. Do not add a new approval gate to already-authorized work.
