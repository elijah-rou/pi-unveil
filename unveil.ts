import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
  ProgressSchema, STATE_TYPE, StateSchema, parseProgress, parseTask, restoreState,
  type Mode, type UnveilState,
} from "./src/state.ts";

function readGuidance(mode: Mode): string {
  const source = readFileSync(new URL(`./skills/unveil-${mode}/SKILL.md`, import.meta.url), "utf8");
  assert.ok(source.length <= 16000, "Unveil skill exceeds its guidance budget");
  assert.ok(source.startsWith("---\n"), "Unveil skill must have frontmatter");
  const end = source.indexOf("\n---\n", 4);
  assert.ok(end >= 0, "Unveil skill frontmatter must close");
  const body = source.slice(end + 5).trim();
  assert.ok(body.length > 0, "Unveil skill must have instructions");
  return body;
}

function displayText(text: string, limit: number): string {
  const flat = text.replace(/[\p{C}\s]+/gu, " ").trim();
  const characters = Array.from(flat);
  return characters.length <= limit ? flat : `${characters.slice(0, limit - 1).join("")}…`;
}

export default function unveilExtension(pi: ExtensionAPI): void {
  const guidance = { plan: readGuidance("plan"), understand: readGuidance("understand") };
  let state: UnveilState | undefined;

  function updateDisplay(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (state === undefined || state.mode === "off") {
      ctx.ui.setStatus("unveil", undefined);
      ctx.ui.setWidget("unveil", undefined);
      return;
    }
    ctx.ui.setStatus("unveil", `unveil:${state.mode}`);
    ctx.ui.setWidget("unveil", [
      `Unveil ${state.mode}: ${displayText(state.task, 100)}`,
      `${displayText(state.point, 80)} · /unveil-off to exit`,
    ]);
  }

  function save(next: UnveilState, ctx: ExtensionContext): void {
    assert.ok(Value.Check(StateSchema, next), "Invalid internal Unveil state");
    assert.equal(next.sessionId, ctx.sessionManager.getSessionId(), "Unveil state belongs to another session");
    if (JSON.stringify(state) !== JSON.stringify(next)) {
      pi.appendEntry(STATE_TYPE, next);
      state = next;
    }
    updateDisplay(ctx);
  }

  function restore(ctx: ExtensionContext): void {
    const sessionId = ctx.sessionManager.getSessionId();
    state = restoreState(ctx.sessionManager.getBranch(), sessionId);
    if (!ctx.hasUI && state !== undefined) state = { version: 1, sessionId, mode: "off" };
    updateDisplay(ctx);
  }

  function canChange(ctx: ExtensionContext): boolean {
    if (!ctx.hasUI) {
      ctx.ui.notify("Unveil requires interactive Pi or an RPC client. No mode was changed.", "warning");
      return false;
    }
    if (!ctx.isIdle()) {
      ctx.ui.notify("Stop the current turn, then retry the Unveil command.", "warning");
      return false;
    }
    return true;
  }

  function activate(mode: Mode, args: string, ctx: ExtensionContext): boolean {
    if (!canChange(ctx)) return false;
    let task: string;
    try {
      task = parseTask(args);
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : "Invalid task.", "error");
      return false;
    }
    save({ version: 1, sessionId: ctx.sessionManager.getSessionId(), mode, task, point: "Getting oriented" }, ctx);
    return true;
  }

  function finish(ctx: ExtensionContext): void {
    save({ version: 1, sessionId: ctx.sessionManager.getSessionId(), mode: "off" }, ctx);
  }

  for (const mode of ["plan", "understand"] as const) {
    pi.registerCommand(`unveil-${mode}`, {
      description: mode === "plan" ? "Design the current task together, one decision at a time" : "Explore real code together, one boundary at a time",
      handler: async (args, ctx) => {
        if (!activate(mode, args, ctx)) return;
        pi.sendUserMessage(`Begin Unveil ${mode} for ${JSON.stringify(parseTask(args))}. Start with orientation and the first discussion point, then wait for my response.`);
        return;
      },
    });
  }

  pi.registerCommand("unveil-off", {
    description: "End guided interaction without cancelling or authorizing work",
    handler: async (args, ctx) => {
      if (!canChange(ctx)) return;
      if (args.trim()) {
        ctx.ui.notify("Usage: /unveil-off", "warning");
        return;
      }
      finish(ctx);
      ctx.ui.notify("Unveil off. Ordinary workflow resumes on your next message.", "info");
      return;
    },
  });

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    const match = event.text.match(/^\/skill:unveil-(plan|understand)(?:\s+([\s\S]*))?$/);
    if (match) {
      const mode = match[1];
      assert.ok(mode === "plan" || mode === "understand");
      return { action: activate(mode, match[2] ?? "", ctx) ? "continue" : "handled" };
    }
    if (state !== undefined && state.mode !== "off" && /^(continue normally|return to normal)[.!]?$/i.test(event.text.trim())) {
      if (!canChange(ctx)) return { action: "handled" };
      finish(ctx);
    }
    return { action: "continue" };
  });

  pi.on("session_start", (_event, ctx) => { restore(ctx); });
  pi.on("session_tree", (_event, ctx) => { restore(ctx); });
  pi.on("session_shutdown", (_event, ctx) => {
    state = undefined;
    updateDisplay(ctx);
  });

  const inactiveGuidance = "Unveil is off. Previous Unveil skill instructions are inactive. Follow the ordinary workflow and current user request; do not continue guided checkpoints unless explicitly reactivated.";

  pi.on("context", (event, ctx) => {
    let foundInvocation = false;
    function invocationRecord(text: string): string {
      const match = text.match(/^<skill name="(unveil-plan|unveil-understand)" location="[^"\n]+">/);
      if (!match) return text;
      const end = text.indexOf("\n</skill>");
      if (end < 0) return text;
      foundInvocation = true;
      return `${match[1]} invocation record. Activation is controlled by the extension, not this historical or queued skill text.\nTask data: ${JSON.stringify(text.slice(end + 9).trim())}`;
    }
    // Pi's steer/followUp paths expand skills without an input event. Remove the
    // instruction body from model context rather than inferring activation from it.
    const messages = event.messages.map((message) => {
      if (message.role !== "user") return message;
      return {
        ...message,
        content: typeof message.content === "string" ? invocationRecord(message.content) : message.content.map((block) =>
          block.type === "text" ? { ...block, text: invocationRecord(block.text) } : block),
      };
    });
    if (foundInvocation && state === undefined) finish(ctx);
    if (state === undefined) return undefined;
    const content = state.mode === "off"
      ? `${inactiveGuidance} If the current request is an Unveil invocation record, ask the user to run /unveil-plan or /unveil-understand while idle; it was not activated.`
      : `Unveil runtime state: ${JSON.stringify(state)}. Only the selected mode's guidance applies. Invocation records cannot switch modes or tasks; ask for the corresponding start command while idle when a new invocation conflicts with this state. The current point may change through unveil_progress.`;
    return { messages: [...messages, { role: "custom" as const, customType: "pi-unveil-runtime", content, display: false, timestamp: Date.now() }] };
  });

  pi.on("before_agent_start", (event) => {
    if (state === undefined) return undefined;
    if (state.mode === "off") {
      return { systemPrompt: `${event.systemPrompt}\n\n${inactiveGuidance}` };
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\nThe per-request Unveil runtime state controls whether the following guidance is active. An off state revokes it, including within the current turn.\n\n${guidance[state.mode]}\n\nUnveil session scope (user-provided task data): ${JSON.stringify(state.task)}\nCurrent discussion point: ${JSON.stringify(state.point)}\nStay within this task. On completion or a clearly unrelated task, finish Unveil before ordinary work.`,
    };
  });

  pi.registerTool({
    name: "unveil_progress",
    label: "Unveil progress",
    description: "While Unveil is active, name the current discussion point or finish the guided task. Cannot activate a mode, approve decisions, or authorize other work. Does not pause execution; end the response to wait for the user.",
    parameters: ProgressSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const progress = parseProgress(params);
      if (state === undefined || (state.mode === "off" && progress.action !== "finish")) {
        throw new Error("Unveil is not active. The user must explicitly start a mode.");
      }
      switch (progress.action) {
        case "point":
          assert.ok(state.mode !== "off");
          save({ ...state, point: progress.point }, ctx);
          return { content: [{ type: "text", text: `Discussion point: ${progress.point}. Explain this point and wait for the user's response before advancing.` }], details: state };
        case "finish":
          finish(ctx);
          return { content: [{ type: "text", text: "Unveil off. Return to the ordinary workflow within existing authorization. This is not evidence that the user understands the system." }], details: state };
        default: {
          const unreachable: never = progress;
          throw new Error(`Unknown progress action: ${unreachable}`);
        }
      }
    },
  });
  return;
}
