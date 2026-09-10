import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const STATE_TYPE = "pi-unveil-state";
export const MAX_TASK = 1000;
export const MAX_POINT = 160;

const identity = {
  version: Type.Literal(1),
  sessionId: Type.String({ minLength: 1, maxLength: 128 }),
};

export const StateSchema = Type.Union([
  Type.Object({ ...identity, mode: Type.Literal("off") }, { additionalProperties: false }),
  Type.Object({
    ...identity,
    mode: StringEnum(["plan", "understand"] as const),
    task: Type.String({ minLength: 1, maxLength: MAX_TASK, pattern: "\\S" }),
    point: Type.String({ minLength: 1, maxLength: MAX_POINT, pattern: "\\S" }),
  }, { additionalProperties: false }),
]);

export type UnveilState = Static<typeof StateSchema>;
export type Mode = Exclude<UnveilState["mode"], "off">;

export const ProgressSchema = Type.Object({
  action: StringEnum(["point", "finish"] as const),
  point: Type.Optional(Type.String({
    minLength: 1, maxLength: MAX_POINT, pattern: "\\S",
    description: "Current discussion point. Required for point; omit for finish.",
  })),
}, { additionalProperties: false });

type Progress = { action: "point"; point: string } | { action: "finish" };

export function parseTask(input: unknown): string {
  if (typeof input !== "string" || input.length > MAX_TASK) {
    throw new Error(`Task must be text of at most ${MAX_TASK} characters.`);
  }
  return input.trim() || "the current task";
}

export function parseProgress(input: unknown): Progress {
  if (!Value.Check(ProgressSchema, input)) throw new Error("Invalid Unveil progress arguments.");
  switch (input.action) {
    case "point":
      if (input.point === undefined) throw new Error("point is required for a point update.");
      return { action: "point", point: input.point.trim() };
    case "finish":
      if (Object.hasOwn(input, "point")) throw new Error("Omit point when finishing Unveil.");
      return { action: "finish" };
    default: {
      const unreachable: never = input.action;
      throw new Error(`Unknown progress action: ${unreachable}`);
    }
  }
}

export function restoreState(entries: readonly SessionEntry[], sessionId: string): UnveilState | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== STATE_TYPE) continue;
    // A corrupt latest record must not resurrect an older active mode.
    if (!Value.Check(StateSchema, entry.data)) return { version: 1, sessionId, mode: "off" };
    // Forks retain earlier chat, including skill instructions that need revoking.
    if (entry.data.sessionId !== sessionId) return { version: 1, sessionId, mode: "off" };
    return entry.data;
  }
  return undefined;
}
