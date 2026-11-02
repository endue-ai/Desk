/**
 * A scripted brain for the browser core (tests and fixture pages, never shipped): brain.ask and
 * brain.status as the core serves them (ADR 0059, crates/desk-core/src/core_ask.rs). An ask needs a
 * prompt and a tool whose schema describes an object, here a self-contained one; its turn streams
 * after the call has answered with the turn's id: started, the words in two deltas, then completed,
 * with `structured` only when the script's arguments match the tool's schema, as the core checks
 * them. A script can leave the brain unreachable for a try: the turn says offline once, with the
 * core's sentence, tries again and says online before it starts. brain.status names the scripted
 * brain as a local model.
 */
import {
  type BrainAskParams,
  type BrainAskTool,
  type BrainTurnData,
  type BridgeEvent,
  StubError,
  type StubHandlers,
} from "@endue-ai/bridge";
import { type SchemaDocument, Schemas } from "../propose/schema";

/** Words without a tool call; the tool's arguments, with words; an error; or no brain this try. */
export type ScriptedAnswer =
  | string
  | { text?: string; structured?: Record<string, unknown> }
  | { error: string }
  | { offline: true };

export interface ScriptedBrain {
  /** The answer to an ask, asked again for each try. */
  answer(prompt: string, tool: BrainAskTool): ScriptedAnswer | Promise<ScriptedAnswer>;
  /** The model brain.status names (default "scripted"). */
  model?: string;
}

/** What the core says while the brain cannot be reached (crates/desk-core/src/conversation.rs). */
export const OFFLINE_LINE =
  "I can't reach endue right now. Check your connection, and I'll pick up where we left off.";
/** Where the scripted brain keeps an ask's tool schema, to check the arguments against it. */
const TOOL = "https://endue.ai/desk/scripted-brain/tool.schema.json";

export function scriptedBrain(
  brain: ScriptedBrain,
  emit: (event: BridgeEvent) => void,
): StubHandlers {
  let turns = 0;
  const ask = (params: BrainAskParams) => {
    const prompt = params.prompt.trim();
    if (!prompt) throw new StubError("invalid_params", "brain.ask needs a prompt");
    const { tool } = params;
    if (tool.schema.type !== "object")
      throw new StubError(
        "invalid_params",
        'tool.schema must describe an object ("type": "object")',
      );
    const schemas = new Schemas([{ ...tool.schema, $id: TOOL } as SchemaDocument]);
    const turnId = `scripted-${++turns}`;
    const send = (kind: BrainTurnData["kind"], extra: Partial<BrainTurnData> = {}) =>
      emit({ event: "brain.turn", data: { turnId, kind, ...extra } });
    const play = async () => {
      let offline = false;
      for (;;) {
        const answer = await brain.answer(prompt, tool);
        if (typeof answer === "object" && "offline" in answer) {
          if (!offline) send("offline", { text: OFFLINE_LINE });
          offline = true;
          await new Promise((wake) => setTimeout(wake, 0));
          continue;
        }
        if (offline) send("online");
        send("started");
        if (typeof answer === "object" && "error" in answer) {
          send("error", { text: answer.error });
          return;
        }
        const text = typeof answer === "string" ? answer : (answer.text ?? "");
        const half = Math.ceil(text.length / 2);
        for (const piece of [text.slice(0, half), text.slice(half)])
          if (piece) send("delta", { text: piece });
        const args = typeof answer === "string" ? undefined : answer.structured;
        const fits = args !== undefined && schemas.validate(args, TOOL, 1).length === 0;
        send("completed", fits ? { structured: args } : {});
        return;
      }
    };
    // After the call's own answer, as the core streams a turn.
    setTimeout(() => void play(), 0);
    return { turnId };
  };
  return {
    "brain.ask": ask,
    "brain.status": () => ({ mode: "local", model: brain.model ?? "scripted" }),
  };
}
