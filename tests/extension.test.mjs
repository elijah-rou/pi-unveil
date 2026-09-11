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

test("native skill invocations never activate or reset extension flow", async () => {
  for (const active of [false, true]) {
    const f = fixture();
    if (active) {
      await f.command("unveil-plan", "Outer task");
      await f.progress({ action: "point", point: "Current decision" });
    }
    const before = f.entries();
    const messageCount = f.messages.length;
    for (const idle of [true, false]) {
      f.setIdle(idle);
      for (const source of ["interactive", "rpc", "extension"]) {
        for (const name of ["unveil-plan", "unveil-understand"]) {
          assert.deepEqual(await f.input(`/skill:${name} inner task`, source), { action: "continue" });
          assert.deepEqual(f.entries(), before);
          assert.equal(f.messages.length, messageCount);
        }
      }
    }
    assert.deepEqual(f.notices, []);
  }
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
  assert.deepEqual(await f.input("/skill:unveil-plan new task", "interactive", "steer"), { action: "continue" });
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
    assert.deepEqual(await f.input("/skill:unveil-plan retries"), { action: "continue" });
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

test("skill bodies and file-read results pass through unchanged in every flow state", async () => {
  for (const flow of ["unused", "active", "off"]) {
    for (const name of ["unveil-plan", "unveil-understand"]) {
      const f = fixture();
      if (flow === "active") await f.command("unveil-plan", "Outer task");
      if (flow === "off") await f.command("unveil-off");
      const before = f.entries();
      const text = `<skill name="${name}" location="/package/skills/${name}/SKILL.md">\nFull skill instructions\n</skill>\n\nInner task`;
      const messages = [
        { role: "user", content: [{ type: "text", text }, { type: "image", data: "fixture", mimeType: "image/png" }], timestamp: 1 },
        { role: "toolResult", toolName: "read", toolCallId: "read-skill", content: [{ type: "text", text: "Skill file body" }], isError: false, timestamp: 2 },
      ];
      const result = await f.emit("context", { messages });
      assert.deepEqual(f.entries(), before);
      if (flow === "unused") assert.equal(result, undefined);
      else {
        assert.deepEqual(result.messages.slice(0, messages.length), messages);
        assert.equal(result.messages[0], messages[0], "do not rewrite native skill input");
        assert.equal(result.messages[1], messages[1], "do not intercept skill reads");
        if (flow === "off") assert.match(result.messages.at(-1).content, /standalone skills/i);
      }
    }
  }
});

test("per-request state revokes guidance immediately after a finish tool and never implicitly switches modes", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Original task");
  const text = '<skill name="unveil-understand" location="/package/SKILL.md">\nOther guidance\n</skill>\n\nOther task';
  const messages = [{ role: "user", content: text, timestamp: 1 }];
  const active = await f.emit("context", { messages });
  assert.match(JSON.stringify(active), /Other guidance/);
  assert.match(active.messages.at(-1).content, /inner skill/i);
  assert.equal(f.entries().at(-1).data.mode, "plan");
  assert.match(active.messages.at(-1).content, /Original task/);
  await f.progress({ action: "finish" });
  const inactive = await f.emit("context", { messages: [] });
  assert.match(inactive.messages.at(-1).content, /Unveil is off/);
  assert.match(inactive.messages.at(-1).content, /standalone skills/i);
});

test("flow controls are supplied by the extension rather than the method", async () => {
  const f = fixture();
  await f.command("unveil-plan", "Outer task");
  const prompt = (await f.prompt()).systemPrompt;
  assert.match(prompt, /unveil_progress/);
  assert.match(prompt, /outer task/i);
  assert.match(prompt, /inner skill/i);
  assert.match(prompt, /\/unveil-off/);
});

test("cancelled progress does not mutate state", async () => {
  const f = fixture();
  await f.command("unveil-plan");
  const before = f.entries();
  await assert.rejects(() => f.progress({ action: "finish" }, AbortSignal.abort()));
  assert.deepEqual(f.entries(), before);
});
