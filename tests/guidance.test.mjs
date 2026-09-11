import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { GUIDANCE_TYPE, RECOVERY_TYPE, GuidanceSchema, RecoverySchema, checkpointRecovery, hasGuidance, replayRecovery } from "../src/guidance.ts";

const state = { version: 1, sessionId: "session-a", mode: "plan", task: "Retries", point: "Initial" };
const hash = "a".repeat(64);
const guidance = { customType: GUIDANCE_TYPE, content: "[Unveil flow control]\nFixture method", display: false,
  details: { version: 1, state, methodHash: hash } };
const control = { role: "custom", ...guidance, timestamp: 1 };
const recovery = { version: 1, checkpointId: "checkpoint", retainedMessageCount: 2, guidance };
const checkpoint = { type: "compaction", id: "checkpoint", summary: "Summary", tokensBefore: 1000, timestamp: new Date(1).toISOString() };
const record = (data) => ({ type: "custom", customType: RECOVERY_TYPE, data });

test("guidance metadata rejects malformed, contradictory, and oversized inputs", () => {
  assert.equal(Value.Check(GuidanceSchema, guidance), true);
  assert.equal(Value.Check(GuidanceSchema, { ...guidance, content: "x" }), true);
  assert.equal(Value.Check(GuidanceSchema, { ...guidance, content: "x".repeat(24000) }), true);
  for (const candidate of [undefined, null, false, 1, [], {},
    { ...guidance, customType: "other" }, { ...guidance, display: true }, { ...guidance, display: undefined },
    ...[undefined, null, "", "x".repeat(24001), 1, [], {}].map(content => ({ ...guidance, content })),
    ...[undefined, null, {}, { ...guidance.details, version: 2 }, { ...guidance.details, state: { ...state, mode: "off" } }].map(details => ({ ...guidance, details })),
    ...[undefined, null, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), 1, NaN, Infinity].map(methodHash => ({ ...guidance, details: { ...guidance.details, methodHash } })),
    { ...guidance, extra: true },
  ]) assert.equal(Value.Check(GuidanceSchema, candidate), false);
});

test("checkpoint recovery validates exact resource and identity boundaries", () => {
  assert.equal(Value.Check(RecoverySchema, recovery), true);
  assert.equal(Value.Check(RecoverySchema, { ...recovery, checkpointId: "x", retainedMessageCount: 1 }), true);
  assert.equal(Value.Check(RecoverySchema, { ...recovery, checkpointId: "x".repeat(128), retainedMessageCount: 100000 }), true);
  for (const candidate of [undefined, null, false, 1, [], {}, { ...recovery, extra: 1 },
    ...[undefined, null, 0, 2, 1.5, NaN, Infinity, "1"].map(version => ({ ...recovery, version })),
    ...[undefined, null, "", "x".repeat(129), 1, [], {}].map(checkpointId => ({ ...recovery, checkpointId })),
    ...[undefined, null, 0, -1, 100001, 1.5, NaN, Infinity, "2", false, [], {}].map(retainedMessageCount => ({ ...recovery, retainedMessageCount })),
    ...[undefined, null, {}, { ...guidance, display: true }].map(guidance => ({ ...recovery, guidance })),
  ]) assert.equal(Value.Check(RecoverySchema, candidate), false);
});

test("only the latest valid control for this session, task and method revision suffices", () => {
  assert.equal(hasGuidance([], state, hash), false);
  assert.equal(hasGuidance([control], state, hash), true);
  assert.equal(hasGuidance([control], { ...state, point: "New point" }, hash), true);
  for (const other of [{ ...state, sessionId: "fork" }, { ...state, mode: "understand" }, { ...state, task: "Other" },
    { version: 1, sessionId: "session-a", mode: "off" }]) assert.equal(hasGuidance([control], other, hash), false);
  assert.equal(hasGuidance([control], state, "b".repeat(64)), false);
  assert.equal(hasGuidance([{ ...control, role: "user" }], state, hash), false);
  assert.equal(hasGuidance([control, { ...control, details: { version: 99 } }], state, hash), false);
  const off = { version: 1, sessionId: "session-a", mode: "off" };
  const finished = { role: "toolResult", toolName: "unveil_progress", isError: false, details: off, content: [] };
  assert.equal(hasGuidance([control, finished], off, hash), true);
  assert.equal(hasGuidance([control, finished], state, hash), false);
  assert.equal(hasGuidance([control, { ...finished, isError: true }], off, hash), false);
  assert.equal(hasGuidance([control, { ...finished, toolName: "other" }], off, hash), false);
  assert.equal(hasGuidance([control, { ...finished, details: { ...off, sessionId: "fork" } }], off, hash), false);
});

test("checkpoint replay is frozen behind retained history, ahead of later input", () => {
  const messages = [
    { role: "compactionSummary", summary: "Summary", tokensBefore: 1000, timestamp: 1 },
    { role: "user", content: "Kept input", timestamp: 2 },
    { role: "assistant", content: [{ type: "text", text: "New response" }], timestamp: 3 },
  ];
  const entries = [checkpoint, record(recovery)];
  const owned = structuredClone(entries);
  const exposed = replayRecovery(owned, messages);
  exposed[2].details.state.point = "Changed by a later context consumer";
  assert.equal(replayRecovery(owned, messages)[2].details.state.point, "Initial");
  const first = replayRecovery(entries, messages);
  assert.equal(first[0], messages[0]);
  assert.equal(first[1], messages[1]);
  assert.deepEqual(first[2], control);
  assert.equal(first[3], messages[2]);
  assert.deepEqual(replayRecovery(entries, [...messages, { role: "user", content: "Later", timestamp: 4 }]).slice(0, first.length), first);
  assert.equal(messages.length, 3);
  assert.equal(checkpointRecovery([checkpoint, record({ ...recovery, checkpointId: "other" })]), undefined);
  assert.equal(checkpointRecovery([checkpoint, record({ ...recovery, version: 99 })]), undefined);
  assert.equal(replayRecovery([], messages), messages);
  assert.equal(replayRecovery([checkpoint, record({ ...recovery, retainedMessageCount: 9 })], messages), messages);
  assert.equal(replayRecovery([{ ...checkpoint, timestamp: "invalid" }, record(recovery)], messages), messages);
  const withoutAnchor = messages.slice(1);
  assert.equal(replayRecovery(entries, withoutAnchor), withoutAnchor);
});
