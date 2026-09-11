import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["unveil-plan", "unveil-understand"];
const bodies = Object.fromEntries(names.map((name) => [name,
  readFileSync(join(root, "skills", name, "SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim(),
]));

for (const extensionEnabled of [false, true]) {
  test(`real Pi standalone skills ${extensionEnabled ? "with" : "without"} flow extension`, { timeout: 20000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-unveil-runtime-"));
    let session;
    try {
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 1024 }, retry: { enabled: false },
      });
      const loader = new DefaultResourceLoader({
        cwd: home, agentDir: join(home, "agent"), settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        additionalExtensionPaths: extensionEnabled ? [join(root, "unveil.ts")] : [],
        additionalSkillPaths: [join(root, "skills")],
        systemPrompt: "Keep existing authorization boundaries.",
      });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      assert.equal(loader.getExtensions().extensions.length, extensionEnabled ? 1 : 0);
      assert.deepEqual(loader.getSkills().diagnostics, []);
      assert.deepEqual(loader.getSkills().skills.map((skill) => skill.name).sort(), names);
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
        sessionManager: sm, settingsManager, resourceLoader: loader,
        tools: extensionEnabled ? ["read", "unveil_progress"] : ["read"],
      });
      session = result.session;
      const errors = [];
      const statuses = new Map();
      await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error),
        uiContext: { notify: () => {}, setStatus: (key, value) => statuses.set(key, value), setWidget: () => {} },
      });
      const initialTools = session.getActiveToolNames();
      const initialModel = session.model;
      const stateEntries = () => sm.getBranch().filter((entry) => entry.type === "custom");

      function assertSkillReceived(name, task) {
        const request = requests.at(-1);
        const text = request.messages.filter((message) => message.role === "user").flatMap((message) => typeof message.content === "string"
          ? [message.content] : message.content.filter((block) => block.type === "text").map((block) => block.text));
        assert.ok(text.some((part) => part.includes(bodies[name]) && part.endsWith(`</skill>\n\n${task}`)),
          `the new ${task} invocation must carry the full ${name} body`);
      }

      async function queueSkill(method, name, scope) {
        const task = `${scope}-${method}-${name}`;
        const pause = { started: Promise.withResolvers(), release: Promise.withResolvers() };
        pauseRequest = pause;
        const pending = session.prompt("An ordinary request");
        await pause.started.promise;
        await session[method](`/skill:${name} ${task}`);
        pause.release.resolve();
        await pending;
        assertSkillReceived(name, task);
      }

      async function command(text) {
        // Command acknowledgement precedes sendUserMessage's actual model turn.
        const settled = new Promise((resolve) => {
          const unsubscribe = session.subscribe((event) => {
            if (event.type !== "agent_settled") return;
            unsubscribe();
            resolve();
          });
        });
        await session.prompt(text);
        await settled;
      }

      for (const name of names) {
        const task = `standalone-direct-${name}`;
        await session.prompt(`/skill:${name} ${task}`);
        assertSkillReceived(name, task);
        for (const method of ["steer", "followUp"]) await queueSkill(method, name, "standalone");
      }
      assert.doesNotMatch(requests.at(-1).systemPrompt, /# Unveil (plan|understand)|Unveil flow support/);
      assert.deepEqual(stateEntries(), []);
      assert.equal(statuses.get("unveil"), undefined);
      assert.deepEqual(errors, []);
      if (!extensionEnabled) return;

      await command("/unveil-plan request retries");
      assert.match(requests.at(-1).systemPrompt, /# Unveil plan/);
      assert.match(requests.at(-1).systemPrompt, /Unveil flow support/);
      assert.equal(statuses.get("unveil"), "unveil:plan");
      replies.push([{ type: "toolCall", id: "point-call", name: "unveil_progress", arguments: { action: "point", point: "At-least-once delivery" } }]);
      await session.prompt("Why not retry without a queue?");
      const outerState = structuredClone(stateEntries());
      assert.equal(outerState.at(-1).data.point, "At-least-once delivery");

      for (const name of names) {
        const task = `inner-direct-${name}`;
        await session.prompt(`/skill:${name} ${task}`);
        assertSkillReceived(name, task);
        for (const method of ["steer", "followUp"]) await queueSkill(method, name, "inner");
        assert.deepEqual(stateEntries(), outerState, "inner invocation must not reset or finish outer flow");
      }
      replies.push([{ type: "toolCall", id: "read-inner", name: "read", arguments: { path: join(root, "skills/unveil-understand/SKILL.md") } }]);
      await session.prompt("Read the understanding skill as an inner helper");
      const readResult = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === "read-inner");
      assert.equal(readResult.isError, false);
      assert.ok(readResult.content.some((block) => block.type === "text" && block.text.includes(bodies["unveil-understand"])));
      assert.deepEqual(stateEntries(), outerState);

      replies.push([{ type: "text", text: "A bounded response to exercise compaction. ".repeat(100) }]);
      await session.prompt("Explain retries once more");
      await session.compact();
      await session.prompt("Return to the outer delivery question");
      assert.ok(sm.getBranch().some((entry) => entry.type === "compaction"));
      assert.match(requests.at(-1).systemPrompt, /At-least-once delivery/);
      assert.match(requests.at(-1).systemPrompt, /Keep existing authorization boundaries/);

      await command("/unveil-understand retry handler");
      assert.match(requests.at(-1).systemPrompt, /# Unveil understand/);
      assert.doesNotMatch(requests.at(-1).systemPrompt, /# Unveil plan/);
      replies.push([{ type: "toolCall", id: "finish-call", name: "unveil_progress", arguments: { action: "finish" } }]);
      await session.prompt("Finish the outer guided task");
      assert.equal(stateEntries().at(-1).data.mode, "off");
      assert.match(JSON.stringify(requests.at(-1).messages), /Unveil is off for extension-managed flow/);

      const beforeOff = requests.length;
      await session.prompt("/unveil-off");
      assert.equal(requests.length, beforeOff);
      const offState = structuredClone(stateEntries());
      for (const name of names) {
        const task = `after-off-direct-${name}`;
        await session.prompt(`/skill:${name} ${task}`);
        assertSkillReceived(name, task);
        assert.match(requests.at(-1).systemPrompt, /does not disable standalone skills/);
        assert.doesNotMatch(requests.at(-1).systemPrompt, /# Unveil (plan|understand)/);
        assert.deepEqual(stateEntries(), offState);
      }
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
}

test("standalone methods contain no extension controls or runtime dependencies", () => {
  for (const body of Object.values(bodies)) {
    assert.doesNotMatch(body, /unveil_progress|\/unveil-(?:off|plan|understand)|extension|ctx\.|pi\./i);
    assert.match(body, /caller.s scope/);
  }
});
