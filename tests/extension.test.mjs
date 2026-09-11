import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import unveil from "../unveil.ts";
import { MAX_TASK, STATE_TYPE } from "../src/state.ts";
import { GUIDANCE_TYPE, RECOVERY_TYPE } from "../src/guidance.ts";

function fixture({ entries = [], sessionId = "session-a", hasUI = true, mode = "tui" } = {}) {
  function manager(records) {
    const normalized = records.map((entry, index) => ({ id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null,
      timestamp: new Date(index).toISOString(), ...entry }));
    return SessionManager.inMemory(process.cwd(), { id: sessionId }, normalized);
  }
  let sm = manager(entries);
  const handlers = new Map(), commands = new Map(), tools = new Map();
  const messages = [], notices = [], statuses = new Map(), widgets = new Map();
  let idle = true;
  const ctx = { hasUI, mode, isIdle: () => idle,
    sessionManager: { getBranch: () => sm.getBranch(), buildContextEntries: () => sm.buildContextEntries(), getSessionId: () => sessionId },
    ui: { notify: (message, level) => notices.push({ message, level }), setStatus: (key, value) => statuses.set(key, value), setWidget: (key, value) => widgets.set(key, value) } };
  unveil({ on: (name, handler) => handlers.set(name, handler), registerCommand: (name, command) => commands.set(name, command),
    registerTool: (tool) => tools.set(tool.name, tool), appendEntry: (name, data) => sm.appendCustomEntry(name, structuredClone(data)),
    sendUserMessage: (text, options) => messages.push({ text, options }) });
  function emit(name, event = {}) { return handlers.get(name)?.(event, ctx); }
  function context() {
    const raw = sm.buildContextEntries().flatMap(sessionEntryToContextMessages);
    return emit("context", { messages: raw })?.messages ?? raw;
  }
  return {
    ctx, commands, tools, messages, notices, statuses, widgets, emit, context,
    entries: () => structuredClone(sm.getBranch().filter((entry) => entry.type === "custom" && entry.customType === STATE_TYPE)),
    branch: () => structuredClone(sm.getBranch()),
    setBranch: (records) => { sm = manager(records); },
    setIdle: (value) => { idle = value; },
    command: (name, args = "") => commands.get(name).handler(args, ctx),
    input: (text, source = "interactive", streamingBehavior) => emit("input", { text, source, streamingBehavior }),
    prompt() {
      const result = emit("before_agent_start", { systemPrompt: "Existing policy" });
      if (result.message) {
        const m = result.message;
        sm.appendCustomMessageEntry(m.customType, m.content, m.display, m.details);
      }
      return result;
    },
    async progress(args, signal) {
      const result = await tools.get("unveil_progress").execute("test-call", args, signal, undefined, ctx);
      sm.appendMessage({ role: "toolResult", toolName: "unveil_progress", toolCallId: "test-call", isError: false,
        content: result.content, details: result.details, timestamp: 1 });
      return result;
    },
    compact(keepGuidance = false) {
      const retained = keepGuidance ? sm.getBranch().find((e) => e.type === "custom_message" && e.customType === GUIDANCE_TYPE).id
        : sm.appendMessage({ role: "user", content: "Retained user input", timestamp: 1 });
      const id = sm.appendCompaction("Fixture summary", retained, 1000);
      emit("session_compact", { compactionEntry: sm.getEntry(id) });
      return sm.getEntry(id);
    },
  };
}

const controls = (f) => f.context().filter((m) => m.role === "custom" && m.customType === GUIDANCE_TYPE);

test("unused flow has only a constant bridge, no state or control messages", async () => {
  const f = fixture();
  await f.emit("session_start", { reason: "startup" });
  const before = f.prompt();
  assert.ok(before.systemPrompt.startsWith("Existing policy\n"));
  assert.equal(before.message, undefined);
  assert.doesNotMatch(before.systemPrompt, /# Unveil (plan|understand)/);
  assert.deepEqual(f.input("Rename this variable"), { action: "continue" });
  assert.deepEqual(f.branch(), []);
  assert.equal(f.messages.length, 0);
  assert.equal(f.statuses.get("unveil"), undefined);
  await assert.rejects(() => f.progress({ action: "point", point: "Something" }), /not active/i);
});

test("commands append selected methods once while the system prefix stays constant", async () => {
  const f = fixture();
  const bridge = f.prompt().systemPrompt;
  for (const mode of ["plan", "understand"]) {
    await f.command(`unveil-${mode}`, "request retries");
    const result = f.prompt();
    assert.equal(result.systemPrompt, bridge);
    assert.match(result.message.content, new RegExp(`# Unveil ${mode}`));
    assert.equal(f.prompt().message, undefined);
    assert.equal(f.entries().at(-1).data.mode, mode);
    assert.equal(f.statuses.get("unveil"), `unveil:${mode}`);
  }
  assert.equal(controls(f).length, 2);
  assert.equal(f.messages.length, 2);
});

test("native skill invocations never activate or reset extension flow", async () => {
  for (const active of [false, true]) {
    const f = fixture();
    if (active) { await f.command("unveil-plan", "Outer task"); f.prompt(); await f.progress({ action: "point", point: "Current decision" }); }
    const before = f.branch();
    for (const idle of [true, false]) {
      f.setIdle(idle);
      for (const source of ["interactive", "rpc", "extension"]) {
        for (const name of ["unveil-plan", "unveil-understand"]) assert.deepEqual(f.input(`/skill:${name} inner task`, source), { action: "continue" });
      }
    }
    assert.deepEqual(f.branch(), before);
    assert.deepEqual(f.notices, []);
  }
});

test("invalid and busy commands cannot replace the current task", async () => {
  const f = fixture();
  await f.command("unveil-plan");
  assert.equal(f.entries().at(-1).data.task, "the current task");
  const before = f.entries();
  await f.command("unveil-understand", "a".repeat(MAX_TASK + 1));
  assert.match(f.notices.at(-1).message, /1000/);
  await f.command("unveil-off", "extra");
  assert.match(f.notices.at(-1).message, /Usage/);
  f.setIdle(false);
  await f.command("unveil-understand", "new task");
  await f.command("unveil-off");
  assert.deepEqual(f.input("continue normally", "interactive", "followUp"), { action: "handled" });
  assert.deepEqual(f.entries(), before);
});

test("point changes update the widget and existing tool results, not full guidance", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Retries");
  const system = f.prompt().systemPrompt;
  await f.progress({ action: "point", point: "Delivery guarantees" });
  assert.match(f.widgets.get("unveil").join("\n"), /Delivery guarantees/);
  const count = f.entries().length;
  await f.progress({ action: "point", point: "Delivery guarantees" });
  assert.equal(f.entries().length, count);
  assert.equal(f.prompt().message, undefined);
  assert.equal(f.prompt().systemPrompt, system);
  assert.equal(controls(f).length, 1);
  assert.match(f.context().at(-1).content[0].text, /Delivery guarantees/);
});

test("successful finish is itself the retained exit; no repeated off packets", async () => {
  const f = fixture();
  await f.command("unveil-plan"); f.prompt();
  await f.progress({ action: "finish" });
  assert.equal(f.entries().at(-1).data.mode, "off");
  assert.equal(f.widgets.get("unveil"), undefined);
  assert.equal(f.prompt().message, undefined);
  assert.equal(f.prompt().message, undefined);
  assert.equal(controls(f).length, 1);
  await assert.rejects(() => f.progress({ action: "point", point: "Invalid" }), /not active/i);
  const count = f.entries().length;
  await f.progress({ action: "finish" });
  assert.equal(f.entries().length, count);
});

test("explicit and natural exits append one off control without another model turn", async () => {
  for (const exit of ["continue normally", "Return to normal.", "/unveil-off"]) {
    const f = fixture();
    await f.command("unveil-plan"); f.prompt();
    f.input("Explain the phrase continue normally");
    assert.equal(f.entries().at(-1).data.mode, "plan");
    if (exit.startsWith("/")) await f.command("unveil-off"); else f.input(exit);
    assert.match(f.prompt().message.content, /Unveil is off/);
    assert.equal(f.prompt().message, undefined);
    assert.equal(f.messages.length, 1);
  }
});

test("retained guidance survives reload/resume; legacy states acquire one control", async () => {
  const f = fixture();
  await f.command("unveil-understand", "Timeout handler"); f.prompt();
  await f.progress({ action: "point", point: "Cancellation" });
  for (const reason of ["startup", "reload", "resume"]) {
    const restored = fixture({ entries: f.branch() });
    restored.emit("session_start", { reason });
    assert.equal(restored.prompt().message, undefined);
    assert.match(restored.widgets.get("unveil").join("\n"), /Cancellation/);
    const legacy = fixture({ entries: f.entries() });
    legacy.emit("session_start", { reason });
    assert.match(legacy.prompt().message.content, /Cancellation/);
    assert.equal(legacy.prompt().message, undefined);
  }
  f.emit("session_shutdown", { reason: "reload" });
  assert.equal(f.widgets.get("unveil"), undefined);
});

test("fork, malformed state, and headless resume append scoped revocation once", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Original"); f.prompt();
  for (const options of [
    { entries: f.branch(), sessionId: "fork-b" },
    { entries: [...f.branch(), { type: "custom", customType: STATE_TYPE, data: { version: 99 } }] },
    { entries: f.branch(), hasUI: false, mode: "print" },
  ]) {
    const other = fixture(options);
    other.emit("session_start", { reason: "resume" });
    assert.match(other.prompt().message.content, /Unveil is off/);
    assert.equal(other.prompt().message, undefined);
  }
  const empty = fixture({ hasUI: false, mode: "json" });
  await empty.command("unveil-plan");
  assert.equal(empty.prompt().message, undefined);
  assert.deepEqual(empty.input("/skill:unveil-plan"), { action: "continue" });
});

test("compaction records one frozen recovery and replays it at a stable summary anchor", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Retries"); f.prompt();
  await f.progress({ action: "point", point: "At checkpoint" });
  const checkpoint = f.compact();
  const records = f.branch().filter((e) => e.type === "custom" && e.customType === RECOVERY_TYPE);
  assert.equal(records.length, 1);
  const first = f.context();
  assert.equal(first[0].role, "compactionSummary");
  assert.equal(first[1].role, "user");
  assert.match(first[2].content, /At checkpoint/);
  assert.equal(f.prompt().message, undefined);
  f.emit("session_compact", { compactionEntry: checkpoint });
  assert.deepEqual(f.branch().filter((e) => e.type === "custom" && e.customType === RECOVERY_TYPE), records);
  await f.progress({ action: "point", point: "Later point" });
  assert.deepEqual(f.context().slice(0, first.length), first);
  assert.match(f.widgets.get("unveil").join("\n"), /Later point/);
  const resumed = fixture({ entries: f.branch() });
  resumed.emit("session_start", { reason: "resume" });
  assert.equal(resumed.prompt().message, undefined);
  assert.deepEqual(resumed.context(), f.context());
});

test("compaction keeps an existing method instead of duplicating it", async () => {
  const f = fixture();
  await f.command("unveil-plan"); f.prompt();
  f.compact(true);
  assert.equal(f.branch().filter((e) => e.type === "custom" && e.customType === RECOVERY_TYPE).length, 0);
  assert.equal(controls(f).length, 1);
  assert.equal(f.prompt().message, undefined);
});

test("recovery follows older retained controls so a new mode wins without another message", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Old task"); f.prompt();
  await f.command("unveil-understand", "New task");
  f.compact(true);
  assert.equal(controls(f).length, 2);
  assert.equal(controls(f).at(-1).details.state.mode, "understand");
  assert.match(controls(f).at(-1).content, /New task/);
  assert.equal(f.prompt().message, undefined);
});

test("tree navigation restores the selected branch, not another branch's control", async () => {
  const f = fixture();
  await f.command("unveil-plan"); f.prompt();
  const active = f.branch();
  await f.command("unveil-off"); f.prompt();
  f.setBranch(active); f.emit("session_tree");
  assert.equal(f.prompt().message, undefined);
  assert.equal(f.statuses.get("unveil"), "unveil:plan");
  f.setBranch([]); f.emit("session_tree");
  assert.equal(f.prompt().message, undefined);
  assert.equal(f.statuses.get("unveil"), undefined);
});

test("ordinary skill content is never rewritten, and displays remain bounded", async () => {
  const f = fixture();
  const raw = [{ role: "user", content: '<skill name="unveil-understand">inner body</skill>', timestamp: 1 }];
  assert.equal(f.emit("context", { messages: raw }), undefined);
  await f.command("unveil-plan", "\u001b[2J\n" + "a".repeat(500)); f.prompt();
  assert.equal(f.emit("context", { messages: raw }), undefined);
  await f.progress({ action: "point", point: "Line\n\u001b[2Jtwo" });
  for (const line of f.widgets.get("unveil")) {
    assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/);
    assert.ok(line.length <= 200);
  }
  const before = f.branch();
  await assert.rejects(() => f.progress({ action: "finish" }, AbortSignal.abort()));
  assert.deepEqual(f.branch(), before);
});
