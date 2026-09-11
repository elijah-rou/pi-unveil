# Standalone skills and brief orientation

## Accepted scope

Implement and publish the agreed refinements, update the bootstrap package pin and both installer snapshot pins, and update the local installation. Preserve unrelated changes.

- Planning opens with a brief problem/success statement and the relevant current components, state, and dataflow. Questions can refine this picture before solution design; no repository-wide tour or approval ceremony.
- Both skills are self-contained conversational methods without extension commands or tools.
- `/skill:unveil-*` stays standalone with or without the extension installed. Native queued invocations and ordinary skill-file reads are not extension control events.
- If flow support is already active, inner skill calls do not restart, switch, or end it. Inner completion returns to the outer task.
- `/unveil-*` commands explicitly activate flow support. The extension owns its status, progress/finish instructions, restoration, and scoped revocation. Off state must not suppress independently requested skills.
- Keep persisted state version 1 and existing resource limits. No new checkpoint engine, permissions, models, or memory system.

## Implementation and acceptance

| Slice | Evidence | Status |
|---|---|---|
| Separate methods from flow controls | 22 passing tests; real Pi standalone/queued/inner invocation tests with unique per-invocation markers; Node 22.18 and 26 | complete |
| Brief orientation and documentation | Skill discovery, two focused source reviews, isolated package archive loading | complete |
| Delivery | Published and installed `615bd0c` (0.2.0); bootstrap runtime `1c393f1`, launcher `1af73a1`, workstation pin `a16ffde`; default repository validators and Linux/macOS package CI passed | complete |

Tests preserve raw skill content, mode/task/point state across inner calls, per-request finish revocation, compaction and session isolation. Source review found a test-evidence ambiguity: queued calls could match an earlier skill body in history. Each invocation now has a unique marker checked together with its full body. No runtime or method-contract defect was established in the focused reviews.

The package's strict TypeScript compiler check passed. The language-server check could not initialize TypeScript from the parent workspace. Model adherence remains a real-user trial, not a claim established by fixture-provider tests.
