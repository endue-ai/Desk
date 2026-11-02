/**
 * Asking the brain for a structured value. `brain.ask` (#305) hands the brain a tool and comes back
 * with the tool's arguments as `structured` on the turn's events; until the core serves it, the asker
 * falls back to `brain.say` with the schema in the prompt and takes the JSON out of the answer. A
 * core that answers `brain.ask` with `unsupported` or `permission_denied`, or cannot read the request
 * at all (no bridge error code: a core older than the method), does not serve it, and the asker
 * remembers that. The answer is never trusted: the caller checks it against its schema.
 */
import type { BrainTurnData, BridgeClient } from "@endue-ai/bridge";

/** brain.say's text is at most this long (specs/bridge/v0); a prompt for brain.ask keeps to it too. */
export const SAY_LIMIT = 8000;

export interface AskTool {
  name: string;
  description: string;
  /** A self-contained JSON Schema of the tool's arguments. */
  schema: Record<string, unknown>;
}

export interface AskRequest {
  /** The question in at most `budget` characters, without the schema. */
  prompt(budget: number): string;
  tool: AskTool;
  /** The schema brain.say's prompt carries: the tool's, without descriptions. */
  compact: Record<string, unknown>;
}

export interface Answer {
  /** The structured value, or the JSON found in the text; undefined when there is none. */
  value: unknown;
  /** What the brain said, as it streamed. */
  text: string;
  via: "ask" | "say";
}

export interface Asker {
  ask(request: AskRequest): Promise<Answer>;
}

export interface AskerOptions {
  /** The brain cannot be reached and the turn waits: the core's sentence for people. */
  onOffline?(text: string): void;
}

/** A turn the brain ended with an error: its sentence is the message. */
export class TurnFailed extends Error {
  override readonly name = "TurnFailed";
}

const ASK = { permission: "brain:ask" } as const;
const CONVERSE = { permission: "brain:converse" } as const;
const ABSENT = new Set(["unsupported", "permission_denied"]);
type LooseCall = (method: string, params: unknown) => Promise<unknown>;

/** What brain.say's prompt ends with: the schema the answer must match. */
export const sayInstruction = (schema: Record<string, unknown>) =>
  `\n\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(schema)}`;

export function createAsker(bridge: BridgeClient, options: AskerOptions = {}): Asker {
  let askable = true;

  /** Start a turn and collect its events until it completes or fails. */
  const turn = (start: () => Promise<unknown>) =>
    new Promise<{ text: string; structured?: unknown }>((resolve, reject) => {
      let id: string | undefined;
      let text = "";
      let structured: unknown;
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
        if (data.turnId !== id) return;
        const value = (data as { structured?: unknown }).structured;
        if (value !== undefined) structured = value;
        if (data.kind === "started") text = "";
        else if (data.kind === "delta") text += data.text ?? "";
        else if (data.kind === "completed")
          finish(() => resolve(structured === undefined ? { text } : { text, structured }));
        else if (data.kind === "error")
          finish(() => reject(new TurnFailed(data.text ?? "The brain could not answer.")));
        else if (data.kind === "offline") options.onOffline?.(data.text ?? "");
      };
      const off = bridge.onEvent((event) => {
        if (event.event !== "brain.turn") return;
        if (id === undefined) early.push(event.data);
        else on(event.data);
      });
      start().then(
        (result) => {
          id = (result as { turnId: string }).turnId;
          for (const data of early.splice(0)) on(data);
        },
        (error: unknown) => finish(() => reject(error)),
      );
    });

  return {
    async ask(request) {
      if (askable) {
        const params = { prompt: request.prompt(SAY_LIMIT), tool: request.tool, scope: ASK };
        try {
          // Typed once #305 puts brain.ask in specs/bridge/v0.
          const call = bridge.call as unknown as LooseCall;
          const done = await turn(() => call.call(bridge, "brain.ask", params));
          return { value: done.structured ?? jsonIn(done.text), text: done.text, via: "ask" };
        } catch (error) {
          if (!absent(error)) throw error;
          askable = false;
        }
      }
      const instruction = sayInstruction(request.compact);
      const text = `${request.prompt(SAY_LIMIT - instruction.length)}${instruction}`;
      const done = await turn(() =>
        bridge.call("brain.say", { text: text.slice(0, SAY_LIMIT), scope: CONVERSE }),
      );
      return { value: jsonIn(done.text), text: done.text, via: "say" };
    },
  };
}

/** Whether a failed brain.ask means the core does not serve it. */
function absent(error: unknown): boolean {
  if (error instanceof TurnFailed) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return code === undefined || ABSENT.has(String(code));
}

/** The JSON object in an answer: a fenced block first, else the first object that parses. */
export function jsonIn(text: string): unknown {
  for (const fence of text.matchAll(/```[a-zA-Z]*[ \t]*\n([\s\S]*?)```/g)) {
    const value = objectOf(fence[1] ?? "");
    if (value !== undefined) return value;
  }
  for (let at = text.indexOf("{"); at >= 0; at = text.indexOf("{", at + 1)) {
    const end = closing(text, at);
    if (end < 0) continue;
    const value = objectOf(text.slice(at, end + 1));
    if (value !== undefined) return value;
  }
  return undefined;
}

function objectOf(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text.trim());
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Where the brace at `open` closes, skipping strings; -1 when it does not. */
function closing(text: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\\") i += 1;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
