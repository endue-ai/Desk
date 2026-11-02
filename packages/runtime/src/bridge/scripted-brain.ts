/**
 * A scripted brain for the browser core (tests and fixture pages, never shipped): `brain.say` and,
 * when asked to, `brain.ask` (#305) answer from a script, as `brain.turn` events after the call has
 * answered with the turn's id: started, the text in two deltas, completed (with `structured` for an
 * ask). Without `ask`, brain.ask stays `unsupported`, as on a core before #305. `brain.status` names
 * the scripted brain as a local model.
 */
import type { BridgeEvent, StubHandlers } from "@endue-ai/bridge";

/** Text to stream, structured values for an ask, or an error that ends the turn. */
export type ScriptedAnswer = string | { text?: string; structured?: unknown } | { error: string };

export interface ScriptedBrain {
  /** The answer to brain.say's text or brain.ask's prompt. */
  answer(prompt: string, via: "say" | "ask"): ScriptedAnswer | Promise<ScriptedAnswer>;
  /** Serve brain.ask too. */
  ask?: boolean;
  /** The model brain.status names (default "scripted"). */
  model?: string;
}

export function scriptedBrain(
  brain: ScriptedBrain,
  emit: (event: BridgeEvent) => void,
): StubHandlers {
  let turns = 0;
  const play = (prompt: string, via: "say" | "ask") => {
    const turnId = `scripted-${++turns}`;
    const send = (kind: "started" | "delta" | "completed" | "error", extra: object = {}) =>
      emit({ event: "brain.turn", data: { turnId, kind, ...extra } } as BridgeEvent);
    // After the call's own answer, as the core streams a turn.
    setTimeout(async () => {
      const answer = await brain.answer(prompt, via);
      send("started");
      if (typeof answer === "object" && "error" in answer) {
        send("error", { text: answer.error });
        return;
      }
      const text = typeof answer === "string" ? answer : (answer.text ?? "");
      const half = Math.ceil(text.length / 2);
      for (const piece of [text.slice(0, half), text.slice(half)])
        if (piece) send("delta", { text: piece });
      const structured = typeof answer === "object" ? answer.structured : undefined;
      send("completed", structured === undefined ? {} : { structured });
    }, 0);
    return { turnId };
  };
  const handlers: Record<string, (params: never) => unknown> = {
    "brain.say": (params: { text: string }) => play(params.text, "say"),
    "brain.status": () => ({ mode: "local", model: brain.model ?? "scripted" }),
  };
  if (brain.ask) handlers["brain.ask"] = (params: { prompt: string }) => play(params.prompt, "ask");
  return handlers as StubHandlers;
}
