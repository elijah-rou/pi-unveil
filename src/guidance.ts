import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { StateSchema, type UnveilState } from "./state.ts";

export const GUIDANCE_TYPE = "pi-unveil-guidance";
export const RECOVERY_TYPE = "pi-unveil-checkpoint";
export type ContextMessage = ReturnType<typeof sessionEntryToContextMessages>[number];

export const GuidanceSchema = Type.Object({
  customType: Type.Literal(GUIDANCE_TYPE),
  content: Type.String({ minLength: 1, maxLength: 24000 }),
  display: Type.Literal(false),
  details: Type.Object({
    version: Type.Literal(1),
    state: StateSchema,
    methodHash: Type.String({ pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type Guidance = Static<typeof GuidanceSchema>;

export const RecoverySchema = Type.Object({
  version: Type.Literal(1),
  checkpointId: Type.String({ minLength: 1, maxLength: 128 }),
  retainedMessageCount: Type.Integer({ minimum: 1, maximum: 100000 }),
  guidance: GuidanceSchema,
}, { additionalProperties: false });
export type Recovery = Static<typeof RecoverySchema>;

function sameFlow(left: UnveilState, right: UnveilState): boolean {
  return left.sessionId === right.sessionId && left.mode === right.mode &&
    (left.mode === "off" || (right.mode !== "off" && left.task === right.task));
}

export function hasGuidance(messages: readonly ContextMessage[], state: UnveilState, methodHash: string): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "custom" && message.customType === GUIDANCE_TYPE) {
      const candidate = { customType: message.customType, content: message.content, display: message.display, details: message.details };
      if (!Value.Check(GuidanceSchema, candidate)) return false;
      return sameFlow(candidate.details.state, state) && candidate.details.methodHash === methodHash;
    }
    if (message?.role === "toolResult" && message.toolName === "unveil_progress" && !message.isError &&
        Value.Check(StateSchema, message.details) && message.details.mode === "off") {
      return sameFlow(message.details, state);
    }
  }
  return false;
}

export function checkpointRecovery(entries: readonly SessionEntry[]): Recovery | undefined {
  const checkpoint = entries[0];
  if (checkpoint?.type !== "compaction") return undefined;
  for (let index = entries.length - 1; index >= 1; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== RECOVERY_TYPE) continue;
    if (Value.Check(RecoverySchema, entry.data) && entry.data.checkpointId === checkpoint.id) return entry.data;
  }
  return undefined;
}

export function replayRecovery(entries: readonly SessionEntry[], messages: ContextMessage[]): ContextMessage[] {
  const checkpoint = entries[0];
  if (checkpoint?.type !== "compaction") return messages;
  const recovery = checkpointRecovery(entries);
  if (recovery === undefined) return messages;
  const anchor = messages.findIndex((message) => message.role === "compactionSummary" &&
    message.summary === checkpoint.summary && message.tokensBefore === checkpoint.tokensBefore);
  if (anchor < 0) return messages;
  const position = anchor + recovery.retainedMessageCount;
  const timestamp = Date.parse(checkpoint.timestamp);
  if (position > messages.length || !Number.isFinite(timestamp)) return messages;
  const restored: ContextMessage = { role: "custom", ...structuredClone(recovery.guidance), timestamp };
  return [...messages.slice(0, position), restored, ...messages.slice(position)];
}

export function retainedMessages(entries: SessionEntry[]): ContextMessage[] {
  return replayRecovery(entries, entries.flatMap(sessionEntryToContextMessages));
}
