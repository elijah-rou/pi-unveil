import assert from "node:assert/strict";
import test from "node:test";
import unveil from "../unveil.ts";
import { MAX_TASK, STATE_TYPE } from "../src/state.ts";

export function fixture({ entries = [], sessionId = "session-a", hasUI = true, mode = "tui" } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const messages = [];
  const notices = [];
  const statuses = new Map();
  const widgets = new Map();
  let branch = [...entries];
  let idle = true;
  const ctx = {
    hasUI, mode,
    isIdle: () => idle,
    sessionManager: { getBranch: () => branch, getSessionId: () => sessionId },
    ui: {
      notify: (message, level) => notices.push({ message, level }),
      setStatus: (key, value) => statuses.set(key, value),
      setWidget: (key, value) => widgets.set(key, value),
    },
  };
  const api = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: (tool) => tools.set(tool.name, tool),
    appendEntry: (customType, data) => branch.push({ type: "custom", customType, data: structuredClone(data) }),
    sendUserMessage: (text, options) => messages.push({ text, options }),
  };
  unveil(api);
  return {
    ctx, commands, tools, messages, notices, statuses, widgets,
    entries: () => structuredClone(branch),
    setBranch: (entries) => { branch = [...entries]; },
    setIdle: (value) => { idle = value; },
    emit: (name, event = {}) => handlers.get(name)?.(event, ctx),
    command: (name, args = "") => commands.get(name).handler(args, ctx),
    progress: (args, signal) => tools.get("unveil_progress").execute("test-call", args, signal, undefined, ctx),
    prompt: () => handlers.get("before_agent_start")({ systemPrompt: "Existing policy" }, ctx),
    input: (text, source = "interactive", streamingBehavior) => handlers.get("input")({ text, source, streamingBehavior }, ctx),
  };
}

test("off by default without prompt changes, user messages, or state writes", async () => {
  const f = fixture();
  await f.emit("session_start", { reason: "startup" });
  assert.equal(await f.prompt(), undefined);
  assert.deepEqual(await f.input("Rename this variable"), { action: "continue" });
  assert.equal(f.entries().length, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.statuses.get("unveil"), undefined);
  assert.equal(f.widgets.get("unveil"), undefined);
  await assert.rejects(() => f.progress({ action: "point", point: "Something" }), /not active/i);
});

test("separate commands inject only the selected skill and preserve existing policy", async () => {
  const f = fixture();
  for (const mode of ["plan", "understand"]) {
    await f.command(`unveil-${mode}`, "request retries");
    assert.equal(f.entries().at(-1).data.mode, mode);
    assert.match(f.statuses.get("unveil"), new RegExp(mode));
    const prompt = (await f.prompt()).systemPrompt;
    assert.ok(prompt.startsWith("Existing policy\n"));
    assert.match(prompt, new RegExp(`# Unveil ${mode}`));
    assert.doesNotMatch(prompt, new RegExp(`# Unveil ${mode === "plan" ? "understand" : "plan"}`));
    assert.match(prompt, /request retries/);
    assert.equal(f.messages.at(-1).options, undefined);
  }
  assert.equal(f.messages.length, 2);
});

test("native skill commands activate while ordinary mentions and injected input do not", async () => {
  const f = fixture();
  for (const text of ["Discuss /skill:unveil-plan", "/skill:unveil-plan-extra", "unveil this", "/skill:unveil-understandx"]) {
    assert.deepEqual(await f.input(text), { action: "continue" });
  }
  assert.deepEqual(await f.input("/skill:unveil-plan retries", "extension"), { action: "continue" });
  assert.equal(f.entries().length, 0);
  for (const source of ["interactive", "rpc"]) {
    assert.deepEqual(await f.input("/skill:unveil-understand retries", source), { action: "continue" });
    assert.equal(f.entries().at(-1).data.mode, "understand");
  }
  assert.equal(f.messages.length, 0, "native skill expansion owns the user message");
});

test("commands accept current-task default, reject excess input, and do not overwrite a busy task", async () => {
  const f = fixture();
  await f.command("unveil-plan");
  assert.equal(f.entries().at(-1).data.task, "the current task");
  const before = f.entries();
  await f.command("unveil-understand", "a".repeat(MAX_TASK + 1));
  assert.deepEqual(f.entries(), before);
  assert.match(f.notices.at(-1).message, /1000/);
  f.setIdle(false);
  await f.command("unveil-understand", "a different task");
  await f.command("unveil-off");
  assert.deepEqual(await f.input("/skill:unveil-plan new task", "interactive", "steer"), { action: "handled" });
  assert.deepEqual(await f.input("continue normally", "interactive", "followUp"), { action: "handled" });
  assert.deepEqual(f.entries(), before);
  assert.match(f.notices.at(-1).message, /current turn/i);
});

test("progress changes the visible point, deduplicates writes, and cannot activate modes", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Retries");
  await f.progress({ action: "point", point: "Delivery guarantees" });
  assert.match(f.widgets.get("unveil").join("\n"), /Delivery guarantees/);
  assert.match((await f.prompt()).systemPrompt, /Delivery guarantees/);
  const length = f.entries().length;
  await f.progress({ action: "point", point: "Delivery guarantees" });
  assert.equal(f.entries().length, length);
  await assert.rejects(() => f.progress({ action: "start", point: "New task" }));
  await f.progress({ action: "finish" });
  assert.equal(f.entries().at(-1).data.mode, "off");
  assert.equal(f.widgets.get("unveil"), undefined);
  assert.match((await f.prompt()).systemPrompt, /Unveil is off/);
  assert.doesNotMatch((await f.prompt()).systemPrompt, /# Unveil plan/);
  await assert.rejects(() => f.progress({ action: "point", point: "New task" }), /not active/i);
  const finished = f.entries().length;
  await f.progress({ action: "finish" });
  assert.equal(f.entries().length, finished);
});

test("off commands and exact natural exits revoke guidance without starting another model turn", async () => {
  for (const exit of ["continue normally", "Return to normal.", "/unveil-off"]) {
    const f = fixture();
    await f.command("unveil-plan", "Retries");
    await f.input("Explain the phrase continue normally");
    assert.equal(f.entries().at(-1).data.mode, "plan");
    if (exit.startsWith("/")) await f.command("unveil-off");
    else assert.deepEqual(await f.input(exit), { action: "continue" });
    assert.equal(f.entries().at(-1).data.mode, "off");
    assert.equal(f.messages.length, 1);
    assert.match((await f.prompt()).systemPrompt, /Unveil is off/);
  }
  const f = fixture();
  await f.command("unveil-plan");
  await f.command("unveil-off", "unexpected arguments");
  assert.equal(f.entries().at(-1).data.mode, "plan");
});

test("reload/resume and compaction retain the current branch; fork/new do not inherit", async () => {
  const f = fixture();
  await f.command("unveil-understand", "Timeout handler");
  await f.progress({ action: "point", point: "State after cancellation" });
  const activeBranch = f.entries();
  await f.emit("session_compact", {});
  assert.match((await f.prompt()).systemPrompt, /State after cancellation/);
  await f.emit("session_shutdown", { reason: "reload" });
  assert.equal(f.widgets.get("unveil"), undefined);
  for (const reason of ["startup", "reload", "resume"]) {
    const restored = fixture({ entries: activeBranch });
    await restored.emit("session_start", { reason });
    assert.match((await restored.prompt()).systemPrompt, /State after cancellation/);
    assert.equal(restored.entries().length, activeBranch.length);
  }
  for (const reason of ["new", "fork", "startup"]) {
    const other = fixture({ entries: activeBranch, sessionId: "session-b" });
    await other.emit("session_start", { reason });
    assert.match((await other.prompt()).systemPrompt, /Unveil is off/, "forked skill text must be explicitly inactive");
  }
  const branched = fixture({ entries: activeBranch });
  await branched.emit("session_start", { reason: "resume" });
  await branched.command("unveil-off");
  branched.setBranch(activeBranch);
  await branched.emit("session_tree", {});
  assert.match((await branched.prompt()).systemPrompt, /State after cancellation/);
  branched.setBranch([]);
  await branched.emit("session_tree", {});
  assert.equal(await branched.prompt(), undefined);
});

test("malformed state disables guidance instead of reviving an older mode", async () => {
  const f = fixture({ entries: [
    { type: "custom", customType: STATE_TYPE, data: { version: 1, sessionId: "session-a", mode: "plan", task: "retry", point: "failure" } },
    { type: "custom", customType: STATE_TYPE, data: { version: 2 } },
  ] });
  await f.emit("session_start", { reason: "resume" });
  assert.match((await f.prompt()).systemPrompt, /Unveil is off/);
});

test("headless invocations stay inactive, while RPC uses plain status and chat", async () => {
  for (const mode of ["print", "json"]) {
    const f = fixture({ hasUI: false, mode });
    await f.command("unveil-plan", "Retries");
    assert.deepEqual(await f.input("/skill:unveil-plan retries"), { action: "handled" });
    assert.equal(await f.prompt(), undefined);
    assert.equal(f.entries().length, 0);
    assert.equal(f.messages.length, 0);
    assert.match(f.notices.at(-1).message, /interactive|RPC/);
    f.setBranch([{ type: "custom", customType: STATE_TYPE, data: { version: 1, sessionId: "session-a", mode: "plan", task: "retry", point: "failure" } }]);
    await f.emit("session_start", { reason: "resume" });
    assert.match((await f.prompt()).systemPrompt, /Unveil is off/, "headless resume must revoke historical guidance");
  }
  const f = fixture({ mode: "rpc" });
  await f.command("unveil-understand", "Retries");
  assert.match((await f.prompt()).systemPrompt, /# Unveil understand/);
});

test("display text is bounded and strips terminal controls without changing stored task data", async () => {
  const f = fixture();
  const task = "\u001b[2J\n" + "a".repeat(500);
  await f.command("unveil-plan", task);
  await f.progress({ action: "point", point: "Line one\n\u001b[2Jline two" });
  const lines = f.widgets.get("unveil");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/);
    assert.ok(line.length <= 200);
  }
  assert.equal(f.entries().at(-1).data.task, task.trim());
});

test("untracked expanded skills cannot activate guidance and explicit off always leaves a revocation record", async () => {
  for (const name of ["unveil-plan", "unveil-understand"]) {
    const f = fixture();
    const text = `<skill name="${name}" location="/package/skills/${name}/SKILL.md">\nReferences are relative to /package.\n\nGuide the user through everything.\n</skill>\n\nQueued task`;
    const input = [{ role: "user", content: [{ type: "text", text }, { type: "image", data: "fixture", mimeType: "image/png" }], timestamp: 1 }];
    const result = await f.emit("context", { messages: input });
    assert.equal(f.entries().at(-1).data.mode, "off");
    assert.doesNotMatch(JSON.stringify(result.messages), /Guide the user through everything/);
    assert.match(result.messages.at(-1).content, /Unveil is off/);
    assert.equal(result.messages[0].content[1], input[0].content[1]);
    assert.equal(input[0].content[0].text, text, "session history is not rewritten");
  }
  const f = fixture();
  await f.command("unveil-off");
  assert.equal(f.entries().at(-1).data.mode, "off");
  assert.match((await f.prompt()).systemPrompt, /Unveil is off/);
  assert.equal(f.messages.length, 0);
});

test("per-request state revokes guidance immediately after a finish tool and never implicitly switches modes", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Original task");
  const text = '<skill name="unveil-understand" location="/package/SKILL.md">\nOther guidance\n</skill>\n\nOther task';
  const messages = [{ role: "user", content: text, timestamp: 1 }];
  const active = await f.emit("context", { messages });
  assert.doesNotMatch(JSON.stringify(active), /Other guidance/);
  assert.equal(f.entries().at(-1).data.mode, "plan");
  assert.match(active.messages.at(-1).content, /Original task/);
  await f.progress({ action: "finish" });
  const inactive = await f.emit("context", { messages: [] });
  assert.match(inactive.messages.at(-1).content, /Unveil is off/);
});

test("cancelled progress does not mutate state", async () => {
  const f = fixture();
  await f.command("unveil-plan");
  const before = f.entries();
  await assert.rejects(() => f.progress({ action: "finish" }, AbortSignal.abort()));
  assert.deepEqual(f.entries(), before);
});
