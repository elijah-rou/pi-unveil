import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { MAX_POINT, MAX_TASK, STATE_TYPE, StateSchema, parseProgress, parseTask, restoreState } from "../src/state.ts";

const active = { version: 1, sessionId: "session-a", mode: "plan", task: "Retry a request", point: "Failure path" };
const entry = (data) => ({ type: "custom", customType: STATE_TYPE, data });

test("task arguments accept an explicit current-task default and bounded text", () => {
  assert.equal(parseTask(""), "the current task");
  assert.equal(parseTask(" \n "), "the current task");
  assert.equal(parseTask("  retry handler  "), "retry handler");
  assert.equal(parseTask("a".repeat(MAX_TASK)).length, MAX_TASK);
  assert.throws(() => parseTask("a".repeat(MAX_TASK + 1)));
  for (const value of [undefined, null, true, 1, 1.5, NaN, Infinity, [], {}]) {
    assert.throws(() => parseTask(value));
  }
});

test("progress distinguishes point updates from finish without ambiguous optional fields", () => {
  assert.deepEqual(parseProgress({ action: "point", point: "  Retry timeout  " }), { action: "point", point: "Retry timeout" });
  assert.deepEqual(parseProgress({ action: "finish" }), { action: "finish" });
  assert.equal(parseProgress({ action: "point", point: "a".repeat(MAX_POINT) }).point.length, MAX_POINT);
  for (const input of [
    undefined, null, false, 1, "finish", [], {},
    { action: undefined }, { action: null }, { action: "start" }, { action: 1.5 }, { action: NaN },
    { action: "point" }, { action: "point", point: undefined }, { action: "point", point: null },
    { action: "point", point: "" }, { action: "point", point: " \n " },
    { action: "point", point: "a".repeat(MAX_POINT + 1) },
    { action: "point", point: true }, { action: "point", point: 1 },
    { action: "point", point: 1.5 }, { action: "point", point: NaN }, { action: "point", point: Infinity },
    { action: "point", point: {} }, { action: "point", point: [] },
    { action: "finish", point: undefined }, { action: "finish", point: null },
    { action: "finish", point: "unused" }, { action: "finish", extra: true },
  ]) assert.throws(() => parseProgress(input), JSON.stringify(input));
});

test("persisted states exclude contradictory and unbounded records", () => {
  for (const mode of ["plan", "understand"]) assert.equal(Value.Check(StateSchema, { ...active, mode }), true);
  assert.equal(Value.Check(StateSchema, { version: 1, sessionId: "session-a", mode: "off" }), true);
  assert.equal(Value.Check(StateSchema, { ...active, task: "a".repeat(MAX_TASK), point: "b".repeat(MAX_POINT) }), true);
  for (const data of [
    undefined, null, false, 1, "plan", [], {},
    { ...active, version: undefined }, { ...active, version: null }, { ...active, version: 0 },
    { ...active, version: 1.5 }, { ...active, version: 2 }, { ...active, version: "1" },
    { ...active, version: NaN }, { ...active, version: Infinity },
    { ...active, sessionId: "" }, { ...active, sessionId: "s".repeat(129) },
    { ...active, sessionId: null }, { ...active, sessionId: undefined }, { ...active, sessionId: 1 },
    { ...active, mode: "off" }, { ...active, mode: "other" }, { ...active, mode: null },
    { ...active, task: undefined }, { ...active, task: null }, { ...active, task: "" },
    { ...active, task: " " }, { ...active, task: 1 }, { ...active, task: "a".repeat(MAX_TASK + 1) },
    { ...active, point: undefined }, { ...active, point: null }, { ...active, point: "" },
    { ...active, point: " " }, { ...active, point: false }, { ...active, point: "a".repeat(MAX_POINT + 1) },
    { ...active, unexpected: true },
  ]) assert.equal(Value.Check(StateSchema, data), false, JSON.stringify(data));
});

test("restore uses only the latest branch state and does not inherit another session", () => {
  assert.equal(restoreState([], "session-a"), undefined);
  assert.deepEqual(restoreState([entry(active)], "session-a"), active);
  assert.deepEqual(restoreState([entry(active)], "fork-b"), { version: 1, sessionId: "fork-b", mode: "off" });
  const off = { version: 1, sessionId: "session-a", mode: "off" };
  assert.deepEqual(restoreState([entry(active), entry(off)], "session-a"), off);
  assert.deepEqual(restoreState([entry(active), entry({ ...active, version: 99 })], "session-a"), off);
  assert.deepEqual(restoreState([entry(active), entry(null)], "session-a"), off);
  assert.deepEqual(restoreState([entry(active), { type: "custom", customType: "unrelated", data: null }], "session-a"), active);
});
