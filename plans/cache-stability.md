# Cache-stable Unveil delivery

## Approved scope

Fix and publish Unveil's cache-hostile prompt updates, install the verified package locally, and advance bootstrap and workstation pins. Preserve independent skills, explicit flow controls, existing authority, and version-1 state records.

## Baseline

A native Codex serialization probe confirmed that activation, point changes, mode changes, and exit rewrite `instructions` ahead of unchanged conversation history. Advancing only the clock did not change the serialized body. Usage drops are real, but neither this reproduction nor Pi's cost estimate proves actual charges or attributes every miss to Unveil.

## Design

- A short, constant system bridge applies in every mode, including unused/off.
- Append a retained control/method message on activation or mode/task change. Emit off once when needed. Progress and finish already have retained tool results.
- Never rewrite existing user, assistant, tool, or standalone-skill messages.
- Compare retained control messages by flow identity and method revision, not point or wall-clock time.
- Recover lost guidance at compaction using one frozen, session-owned checkpoint snapshot, projected immediately after that checkpoint's retained messages. This fixed anchor preserves the new prefix through subsequent tool calls without unsafe message insertion inside a tool batch.
- Resume/tree navigation uses the selected branch and retained context; old version-1 states receive guidance only when absent. Fork/headless contexts stay off.
- Keep provider cache settings unchanged. An upgrade/reload or compaction may rebuild a prefix; unrelated extensions/provider behavior remain outside the guarantee.

## Acceptance

| Slice | Evidence | Status |
|---|---|---|
| Prefix regression | Native Codex `instructions` equality and append-only input comparisons across activation, progress, switch, task change, exit, and repeated requests | passed |
| Retained guidance and recovery | Real Pi tool/result ordering, manual/threshold/overflow compaction, error and length retries, resume/fork, malformed metadata, and standalone use | passed |
| Publication | Two focused source reviews complete; overflow finding fixed and re-reviewed. 27 tests, strict compiler, and packaged loading pass. Repository pins and local installation follow the runtime commit. | in progress |

## Verification notes

The native prefix regression failed on 0.2.0 at activation. Metadata aliasing and overflow-retry regressions also failed before their fixes. The final suite passes without network requests. Node 22 packaging and strict compilation pass; one timeout run coincided with macOS sleep, then targeted reruns passed. LSP initialization cannot find TypeScript from the parent workspace; package-local `tsc --noEmit` supplies the compiler check.
