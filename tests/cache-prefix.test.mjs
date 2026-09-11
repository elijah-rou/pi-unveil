import assert from "node:assert/strict";
import test from "node:test";
import unveil from "../unveil.ts";
import { convertToLlm } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js";
import { stream } from "../node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js";

const model = { id: "gpt-6-astra", name: "Fixture", api: "openai-codex-responses", provider: "openai-codex",
  baseUrl: "https://example.invalid", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const token = Buffer.from("{}").toString("base64url") + "." + Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "fixture" },
})).toString("base64url") + ".fixture";

test("native Codex prefix survives every Unveil control transition", { timeout: 10000 }, async () => {
  const hooks = new Map(), commands = new Map(), tools = new Map(), entries = [];
  const messages = [{ role: "user", content: "Unchanged synthetic conversation. ".repeat(12000), timestamp: 1 }];
  const ctx = { hasUI: true, isIdle: () => true,
    sessionManager: { getSessionId: () => "cache-test", getBranch: () => entries, buildContextEntries: () => entries },
    ui: { setStatus() {}, setWidget() {}, notify() {} } };
  unveil({ on: (name, fn) => hooks.set(name, fn), registerCommand: (name, value) => commands.set(name, value),
    registerTool: (tool) => tools.set(tool.name, tool),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }), sendUserMessage() {} });
  const snapshots = [];
  async function capture(label) {
    messages.push({ role: "user", content: label, timestamp: snapshots.length + 2 });
    const before = await hooks.get("before_agent_start")({ systemPrompt: "Stable host policy." }, ctx);
    if (before?.message) {
      const data = { ...before.message, timestamp: 1 };
      messages.push({ ...data, role: "custom" });
      entries.push({ ...data, type: "custom_message", timestamp: new Date(1).toISOString() });
    }
    const transformed = await hooks.get("context")?.({ messages }, ctx);
    let payload;
    const response = await stream(model, {
      systemPrompt: before?.systemPrompt ?? "Stable host policy.", messages: convertToLlm(transformed?.messages ?? messages), tools: [],
    }, { apiKey: token, sessionId: "cache-test", transport: "sse", cacheRetention: "short",
      onPayload(body) { payload = body; throw new Error("CAPTURE_ONLY_NO_NETWORK"); },
    }).result();
    assert.ok(payload);
    assert.match(response.errorMessage, /CAPTURE_ONLY_NO_NETWORK/);
    const previous = snapshots.at(-1);
    if (previous) {
      assert.equal(payload.instructions, previous.instructions, `${label}: system instructions changed`);
      assert.deepEqual(payload.input.slice(0, previous.input.length), previous.input, `${label}: earlier input prefix changed`);
      assert.equal(payload.prompt_cache_key, previous.prompt_cache_key);
      assert.deepEqual(payload.tools, previous.tools);
    }
    snapshots.push(payload);
  }
  await capture("unused");
  await commands.get("unveil-plan").handler("Retries", ctx);
  await capture("activate");
  await tools.get("unveil_progress").execute("point", { action: "point", point: "Delivery guarantees" }, undefined, undefined, ctx);
  await capture("progress state changed");
  await capture("same mode and point");
  await commands.get("unveil-plan").handler("Different task", ctx);
  await capture("task change");
  await commands.get("unveil-understand").handler("Different task", ctx);
  await capture("mode switch");
  await commands.get("unveil-off").handler("", ctx);
  await capture("off");
  await capture("still off");
  await commands.get("unveil-plan").handler("Retries", ctx);
  await capture("reactivate");
});
