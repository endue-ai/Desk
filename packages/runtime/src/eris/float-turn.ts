/**
 * The floating Eris's turns with the brain (ADR 0121). A typed line goes to `brain.say` as the desk
 * (the native host pins the window's caller, so it is the desk's one conversation, ADR 0027) and is
 * followed through its `brain.turn` events to one answer. The desk's turns are watched for her
 * status: thinking while one runs, waiting while an agent's call in one waits for the person's
 * approval (ADR 0078).
 */
import type { BrainTurnData, BridgeClient, BridgeEvent } from "@endue-ai/bridge";

/** The core as the floating window reaches it. */
export type FloatCore = Pick<BridgeClient, "call" | "onEvent">;

const SCOPE = { permission: "brain:converse" } as const;

/** An event for the desk: addressed to it, or to everyone. */
function forDesk(event: BridgeEvent): boolean {
  const to = (event as { to?: unknown }).to;
  return !Array.isArray(to) || to.includes("desk");
}

/** `text` to Eris; resolves with her answer, rejects when the turn fails or the call does. */
export function askEris(core: FloatCore, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let turnId: string | undefined;
    let answer = "";
    let done = false;
    // Events can arrive before brain.say answers with the turn's id; they wait for it here.
    const early: BrainTurnData[] = [];
    const finish = (settle: () => void) => {
      done = true;
      off();
      settle();
    };
    const on = (data: BrainTurnData) => {
      if (done || data.turnId !== turnId) return;
      if (data.kind === "started") answer = "";
      else if (data.kind === "delta") answer += data.text ?? "";
      else if (data.kind === "completed") finish(() => resolve(answer));
      else if (data.kind === "error") finish(() => reject(new Error(data.text ?? "")));
      // offline and online: the core retries, so the answer keeps waiting.
    };
    const off = core.onEvent((event) => {
      if (event.event !== "brain.turn") return;
      if (turnId === undefined) early.push(event.data);
      else on(event.data);
    });
    core.call("brain.say", { text, scope: SCOPE }).then(
      (result) => {
        turnId = result.turnId;
        for (const data of early.splice(0)) on(data);
      },
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export interface BrainWatch {
  /** A turn of the desk's is running. */
  thinking(): boolean;
  /** An agent's call waits for the person's approval. */
  approval(): boolean;
  dispose(): void;
}

/** Follow the desk's turns and approvals; `changed` hears every change. */
export function watchBrain(core: FloatCore, changed: () => void): BrainWatch {
  const turns = new Set<string>();
  // Approvals by id, with the turn each belongs to when it has one.
  const approvals = new Map<string, string | undefined>();
  const off = core.onEvent((event) => {
    if (!forDesk(event)) return;
    if (event.event === "brain.turn") {
      const { turnId, kind } = event.data;
      if (kind === "started" || kind === "delta" || kind === "tool" || kind === "tool-result")
        turns.add(turnId);
      else if (kind === "completed" || kind === "error") {
        turns.delete(turnId);
        // A refused approval says nothing more; the turn's end closes it.
        for (const [id, task] of approvals)
          if (task === turnId || task === undefined) approvals.delete(id);
      } else return;
    } else if (event.event === "perm.approval") {
      approvals.set(event.data.approvalId, event.data.task);
    } else if (event.event === "perm.approval.done") {
      approvals.delete(event.data.approvalId);
    } else return;
    changed();
  });
  return {
    thinking: () => turns.size > 0,
    approval: () => approvals.size > 0,
    dispose: off,
  };
}
