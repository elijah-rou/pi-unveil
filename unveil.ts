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
    description: "End extension-managed guidance without cancelling or authorizing work",
    handler: async (args, ctx) => {
      if (!canChange(ctx)) return;
      if (args.trim()) {
        ctx.ui.notify("Usage: /unveil-off", "warning");
        return;
      }
      finish(ctx);
      ctx.ui.notify("Unveil flow support off. Standalone skills remain available.", "info");
      return;
    },
  });

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
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

  const inactiveGuidance = "Unveil is off for extension-managed flow. Previous extension-managed method and control instructions are inactive. This does not disable standalone skills: follow independently requested skills and the user's current task normally.";
  const flowGuidance = `# Unveil flow support
This extension facilitates the outer task using the method below. The per-request runtime state controls only extension-managed guidance; off revokes that guidance even within the current turn, not independently invoked skills.
Use unveil_progress with action point to name the current outer discussion point. The tool updates the display but does not pause execution; end the response to wait for the user.
Skill invocations and skill-file reads are not mode controls. An inner skill may help with the current task without restarting, switching, or finishing this flow. When that helper finishes, return to the outer task; do not finish the flow merely because an inner skill completed.
Use unveil_progress with action finish when the outer guided task is complete, the user explicitly stops guidance, or a clearly unrelated task begins. Preserve existing implementation and publication authorization. Questions about nearby code or alternatives stay within the discussion.
If the progress tool is unavailable when ending, do not claim to have changed extension state. Ask the user to run /unveil-off or say "continue normally". Only /unveil-plan and /unveil-understand activate or switch extension modes.`;

  pi.on("context", (event) => {
    if (state === undefined) return undefined;
    const content = state.mode === "off"
      ? inactiveGuidance
      : `Unveil outer-task runtime state: ${JSON.stringify(state)}. Inner skill calls do not change this state. Apply their methods within the caller's scope and return to the outer task when they finish. Do not infer a mode switch or flow completion from a skill invocation or file read.`;
    return { messages: [...event.messages, { role: "custom" as const, customType: "pi-unveil-runtime", content, display: false, timestamp: Date.now() }] };
  });

  pi.on("before_agent_start", (event) => {
    if (state === undefined) return undefined;
    if (state.mode === "off") {
      return { systemPrompt: `${event.systemPrompt}\n\n${inactiveGuidance}` };
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${flowGuidance}\n\n<unveil-outer-method>\n${guidance[state.mode]}\n</unveil-outer-method>\n\nOuter task (user-provided data): ${JSON.stringify(state.task)}\nCurrent discussion point: ${JSON.stringify(state.point)}`,
    };
  });

  pi.registerTool({
    name: "unveil_progress",
    label: "Unveil progress",
    description: "While Unveil flow support is active, name the outer discussion point or finish the outer guided task. Inner skill completion is not outer-task completion. Cannot activate a mode, approve decisions, or authorize other work. Does not pause execution; end the response to wait for the user.",
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
          return { content: [{ type: "text", text: "Unveil flow support off. Extension-managed guidance has ended; standalone skills remain available. Continue within existing authorization. This is not evidence that the user understands the system." }], details: state };
        default: {
          const unreachable: never = progress;
          throw new Error(`Unknown progress action: ${unreachable}`);
        }
      }
    },
  });
  return;
}
