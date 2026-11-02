/**
 * Asking the brain for a structured value with brain.ask (ADR 0059): the prompt and a tool go to the
 * core, which asks in a session of its own and hands the tool call's arguments back as `structured`
 * on the completed brain.turn, only when they match the tool's schema. A brain that answered in words,
 * or called the tool with arguments its schema refuses, completes without them, and the value is
 * undefined: the asker never reads JSON out of words. The core serves brain.ask wherever it serves
 * brain.say, and the runtime holds brain:ask, so there is no other way to ask. The caller still checks
 * the value against its own rules before anything uses it.
 */
import type { BrainAskTool, BrainTurnData, BridgeClient } from "@endue-ai/bridge";

/** brain.ask's prompt is at most this long (specs/bridge/v0). */
export const ASK_LIMIT = 32000;

/** The tool the brain answers through: its name, what it is for, and the schema of its arguments. */
export type AskTool = BrainAskTool;

export interface AskRequest {
  /** The question in at most `budget` characters. */
  prompt(budget: number): string;
  tool: AskTool;
}

export interface Answer {
  /** The tool's arguments, or undefined when the brain gave no call that its schema allows. */
  value: Record<string, unknown> | undefined;
  /** What the brain said in words, as it streamed. */
  text: string;
}

export interface Asker {
  ask(request: AskRequest): Promise<Answer>;
}

export interface AskerOptions {
  /** The brain cannot be reached and the ask waits for it: the core's sentence for people. */
  onOffline?(text: string): void;
}

/** A turn the brain ended with an error: its sentence is the message. */
export class TurnFailed extends Error {
  override readonly name = "TurnFailed";
}

const SCOPE = { permission: "brain:ask" } as const;
/** The most events kept while the call has not named its turn yet. */
const EARLY = 64;

export function createAsker(bridge: BridgeClient, options: AskerOptions = {}): Asker {
  return {
    ask: (request) =>
      new Promise<Answer>((resolve, reject) => {
        let turnId: string | undefined;
        let text = "";
        let done = false;
        // Events can arrive before the call answers with the turn's id; they wait for it here.
        const early: BrainTurnData[] = [];
        const finish = (end: () => void) => {
          if (done) return;
          done = true;
          off();
          end();
        };
        const on = (data: BrainTurnData) => {
          if (data.turnId !== turnId) return;
          // A turn that waited for the brain starts again once it is back.
          if (data.kind === "started") text = "";
          else if (data.kind === "delta") text += data.text ?? "";
          else if (data.kind === "completed")
            finish(() => resolve({ value: data.structured, text }));
          else if (data.kind === "error")
            finish(() => reject(new TurnFailed(data.text ?? "The brain could not answer.")));
          else if (data.kind === "offline") options.onOffline?.(data.text ?? "");
        };
        const off = bridge.onEvent((event) => {
          if (event.event !== "brain.turn") return;
          if (turnId !== undefined) on(event.data);
          else if (early.length < EARLY) early.push(event.data);
        });
        const prompt = request.prompt(ASK_LIMIT).slice(0, ASK_LIMIT);
        bridge.call("brain.ask", { prompt, tool: request.tool, scope: SCOPE }).then(
          (result) => {
            turnId = result.turnId;
            for (const data of early.splice(0)) on(data);
          },
          (error: unknown) => finish(() => reject(error)),
        );
      }),
  };
}
