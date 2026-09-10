import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));

test("Pi 0.85.1 loads the package and carries a guided conversation through native commands and skills", { timeout: 20000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-unveil-runtime-"));
  let session;
  try {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 1024 }, retry: { enabled: false },
    });
    const loader = new DefaultResourceLoader({
      cwd: home, agentDir: join(home, "agent"), settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [join(root, "unveil.ts")],
      additionalSkillPaths: [join(root, "skills")],
      systemPrompt: "Keep existing authorization boundaries.",
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    assert.deepEqual(loader.getSkills().diagnostics, []);
    assert.deepEqual(loader.getSkills().skills.map((skill) => skill.name).sort(), ["unveil-plan", "unveil-understand"]);
    assert.ok(loader.getSkills().skills.every((skill) => skill.disableModelInvocation));

    const requests = [];
    const replies = [];
    let pauseRequest;
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null,
      allowModelNetwork: false, refreshOnCreate: false, signal: AbortSignal.timeout(5000),
    });
    runtime.registerProvider("unveil-test", {
      api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "not-a-real-key",
      models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
      streamSimple(model, context) {
        requests.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
        const content = replies.shift() ?? [{ type: "text", text: "Fixture response. Which part would you like to discuss?" }];
        const reason = content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
          stopReason: reason, timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        const stream = createAssistantMessageEventStream();
        const pause = pauseRequest;
        pauseRequest = undefined;
        function complete() {
          stream.push({ type: "done", reason, message });
          stream.end();
        }
        if (pause) {
          pause.started.resolve();
          void pause.release.promise.then(complete);
        } else complete();
        return stream;
      },
    });
    const sm = SessionManager.inMemory(home);
    const result = await createAgentSession({
      cwd: home, agentDir: join(home, "agent"), modelRuntime: runtime,
      model: runtime.getModel("unveil-test", "fixture"), thinkingLevel: "off",
      sessionManager: sm, settingsManager, resourceLoader: loader, tools: ["read", "unveil_progress"],
    });
    session = result.session;
    const errors = [];
    const notices = [];
    const statuses = new Map();
    await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error),
      uiContext: { notify: (message) => notices.push(message), setStatus: (key, value) => statuses.set(key, value), setWidget: () => {} },
    });
    assert.doesNotMatch(session.agent.state.systemPrompt, /# Unveil (plan|understand)/);
    const initialTools = session.getActiveToolNames();
    const initialModel = session.model;

    // RPC queue APIs bypass input hooks; exercise both real entry points.
    for (const [method, skill] of [["steer", "unveil-plan"], ["followUp", "unveil-understand"]]) {
      const pause = { started: Promise.withResolvers(), release: Promise.withResolvers() };
      pauseRequest = pause;
      const pending = session.prompt("An ordinary request");
      await pause.started.promise;
      await session[method](`/skill:${skill} queued task`);
      pause.release.resolve();
      await pending;
      const request = requests.at(-1);
      assert.doesNotMatch(JSON.stringify(request.messages), /# Unveil (plan|understand)/);
      assert.match(JSON.stringify(request.messages), /Unveil is off/);
      assert.equal(sm.getBranch().filter((entry) => entry.type === "custom").at(-1).data.mode, "off");
      await session.prompt("/unveil-off");
      await session.prompt("Continue ordinary work");
      assert.match(requests.at(-1).systemPrompt, /Unveil is off/);
    }

    // Native skill expansion is handled by Pi, not a fixture command dispatcher.
    await session.prompt("/skill:unveil-plan request retries");
    assert.ok(requests.length > 0, JSON.stringify({ notices, errors, lastMessage: session.messages.at(-1) }));
    assert.match(requests.at(-1).systemPrompt, /# Unveil plan/);
    assert.match(requests.at(-1).systemPrompt, /request retries/);
    assert.equal(statuses.get("unveil"), "unveil:plan");
    assert.match(JSON.stringify(requests.at(-1).messages), /unveil-plan invocation record/);
    assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /Develop the reasoning together/, "skill bodies belong in active guidance, not instruction history");

    replies.push([{ type: "toolCall", id: "point-call", name: "unveil_progress", arguments: { action: "point", point: "At-least-once delivery" } }]);
    await session.prompt("Why not retry without a queue?");
    assert.equal(sm.getBranch().filter((entry) => entry.type === "custom").at(-1).data.point, "At-least-once delivery");
    assert.ok(session.messages.some((message) => message.role === "toolResult" && message.toolName === "unveil_progress" && !message.isError));

    await session.prompt("Show the failure path");
    assert.match(requests.at(-1).systemPrompt, /At-least-once delivery/);
    assert.match(requests.at(-1).systemPrompt, /Keep existing authorization boundaries/);

    replies.push([{ type: "text", text: "A bounded response to exercise compaction. ".repeat(100) }]);
    await session.prompt("Explain retries once more");
    await session.compact();
    await session.prompt("Return to the delivery guarantee");
    assert.ok(sm.getBranch().some((entry) => entry.type === "compaction"));
    assert.match(requests.at(-1).systemPrompt, /# Unveil plan/);
    assert.match(requests.at(-1).systemPrompt, /At-least-once delivery/);

    // Command acknowledgement precedes the prompt started by sendUserMessage.
    const settled = new Promise((resolve) => {
      const unsubscribe = session.subscribe((event) => {
        if (event.type !== "agent_settled") return;
        unsubscribe();
        resolve();
      });
    });
    await session.prompt("/unveil-understand retry handler");
    await settled;
    assert.match(requests.at(-1).systemPrompt, /# Unveil understand/);
    assert.doesNotMatch(requests.at(-1).systemPrompt, /# Unveil plan/);

    const beforeOff = requests.length;
    await session.prompt("/unveil-off");
    assert.equal(requests.length, beforeOff, "exit should not trigger a model request");
    await session.prompt("Now answer normally");
    assert.match(requests.at(-1).systemPrompt, /Unveil is off/);
    assert.doesNotMatch(requests.at(-1).systemPrompt, /# Unveil (plan|understand)/);
    assert.equal(statuses.get("unveil"), undefined);
    assert.deepEqual(session.getActiveToolNames(), initialTools);
    assert.equal(session.model, initialModel);
    assert.equal(session.thinkingLevel, "off");
    assert.deepEqual(errors, []);
  } finally {
    session?.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("manifest includes both skills and every runtime source without development artifacts", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.pi, { extensions: ["./unveil.ts"], skills: ["./skills"] });
  for (const file of ["unveil.ts", "src/state.ts", "skills/unveil-plan/SKILL.md", "skills/unveil-understand/SKILL.md"]) {
    assert.ok(readFileSync(join(root, file)).length > 0);
  }
  assert.ok(!manifest.files.includes("tests"));
  assert.ok(!manifest.files.includes("plans"));
});
