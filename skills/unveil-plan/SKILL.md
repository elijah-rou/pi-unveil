---
name: unveil-plan
description: Develop a software design interactively, explaining consequential choices and concrete program behavior while the user questions and redirects decisions. Explicit invocation only; not ordinary autonomous planning or interview assessment.
disable-model-invocation: true
---

# Unveil plan

Guide the user through designing the current task. Develop the reasoning together instead of presenting a finished plan for approval. Explain useful rationale grounded in constraints, code, and evidence; do not provide private internal reasoning. This is collaboration, not a quiz. Offer predictions or implementation exercises only when the user requests them.

## Establish the shared view

Inspect the relevant instructions, implementation, tests, and settled decisions. Before proposing solutions, present a brief shared view: what problem we are solving, the evidence for it, and the observable result we want; then the current system's relevant components, responsibilities, state, and one representative dataflow. Distinguish observed behavior from assumptions and name only consequential unknowns.

Keep this opening to a short problem paragraph and a compact current-system sketch, not a repository-wide tour. For a new system, show the surrounding systems and constraints instead of inventing an existing implementation. Invite questions or corrections and leave room for discussion before entering solution design, without requiring a separate approval. Expand only where needed to answer the user's questions. Reuse an already-established shared view rather than repeating the opening.

Use the repository's existing planning process and artifacts. If an existing planning skill applies, retain its outcome, system-fit, program-shape, and verification requirements. This skill changes the interaction, not the planning authority or required artifacts. An existing design can still be walked through when the user wants to examine it.

Completion criterion: the problem, desired outcome, and relevant current behavior are visible before solution choices are introduced.

## Work one decision at a time

For the current consequential decision:

1. Explain what we are choosing, why it matters now, and the constraints it must satisfy.
2. Show enough concrete program shape to make the choice inspectable: relevant owners or files, an interface or state shape, and a representative success or failure path. Match the detail to this decision rather than filling a template.
3. Recommend an approach with its accepted cost and strongest viable alternative, including a simpler baseline when applicable. State what evidence or changed constraint would reverse the recommendation. Do not invent options or measured advantages.
4. Invite the user's questions or changes before moving on, then end the response and wait. Do not run through later decisions in the same answer. You may gather evidence needed to answer the current question before pausing.

Explain first rather than withholding an answer until the user guesses. A short route map is useful; a complete design dump is not. These requested discussion points apply even when the agent could choose confidently on its own. Routine details do not each need a checkpoint.

## Follow the user's direction

Treat “why?”, “show the code”, “go deeper”, “back up”, and alternatives as directions within the current discussion. Answer the question before trying to advance. “Continue” advances the discussion, not authorization to implement or publish. “Continue normally” exits guidance, including when followed by instructions for the remaining work. Do not demand a particular phrase or repeated approval clicks.

When the user changes a choice, identify the affected downstream decisions and reopen only those invalidated by the change. Record accepted choices, costs, evidence, and unresolved assumptions in the existing plan when one is warranted. Keep tentative proposals distinct from accepted decisions. Revisiting a choice does not undo files or Git history.

Keep customer context relevant to the technical decision. Product discovery or coaching is a separate activity when requested; do not invent customer evidence or turn every design into a product interview.

Completion criterion: the next decision follows from the user's current direction, with affected assumptions updated.

## Close or hand back control

When the guided task is complete, summarize the accepted design, remaining questions, and the next authorized action. Distinguish software verification from demonstrated understanding; assent is not evidence of competence. Do not create scores, a learning database, or new progress documents just for this interaction.

End this guided discussion when its task is complete, the user asks to stop or says “continue normally”, or a clearly unrelated task begins. If this method was used as a helper inside a larger task, return to that caller's scope rather than declaring the outer task complete. Otherwise return to the ordinary workflow. This method needs no special commands, tools, or persistent mode state.

Preserve existing authorization boundaries. Planning alone does not authorize implementation; existing implementation approval remains valid unless changed. After the requested guided checkpoints are complete, continue any already-authorized work without adding new approval gates.
