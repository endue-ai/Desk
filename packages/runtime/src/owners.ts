/**
 * Routes owned events (brain turns, fs watches, processes) to the plugin whose call started them:
 * a plugin hears about its own work and nothing of other plugins'. Events that arrive before the
 * call's answer names their key wait for the claim, in order, so a process that writes at once is
 * not missed.
 */
import type {
  BrainSayResult,
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  FsWatchResult,
  ProcSpawnResult,
} from "@endue-ai/bridge";

/** How many unclaimed keys keep their early events. */
const EARLY_KEYS = 32;

/** The key an owned event belongs to, or undefined for events that are not owned by one plugin. */
export function eventKey(event: BridgeEvent): string | undefined {
  switch (event.event) {
    case "brain.turn":
      return `turn:${event.data.turnId}`;
    case "fs.changed":
      return `watch:${event.data.watchId}`;
    case "proc.output":
    case "proc.exit":
      return `proc:${event.data.procId}`;
    default:
      return undefined;
  }
}

/** The key a successful call starts: its events go to the plugin that made the call. */
export function claimKey(request: BridgeRequest, response: BridgeResponse): string | undefined {
  if (!response.ok) return undefined;
  switch (request.method) {
    case "brain.say":
      return `turn:${(response.result as BrainSayResult).turnId}`;
    case "fs.watch":
      return `watch:${(response.result as FsWatchResult).watchId}`;
    case "proc.spawn":
      return `proc:${(response.result as ProcSpawnResult).procId}`;
    default:
      return undefined;
  }
}

/** Whether the event is the last one for its key. */
function ends(event: BridgeEvent): boolean {
  if (event.event === "brain.turn") {
    return event.data.kind === "completed" || event.data.kind === "error";
  }
  return event.event === "proc.exit";
}

export class Owners {
  readonly #owners = new Map<string, string>();
  readonly #early = new Map<string, BridgeEvent[]>();

  /**
   * The plugin an owned event goes to. Undefined when nobody owns the key yet: the event waits for
   * a claim, or is dropped once too many keys wait.
   */
  route(event: BridgeEvent, key: string): string | undefined {
    const owner = this.#owners.get(key);
    if (owner === undefined) {
      const early = this.#early.get(key) ?? [];
      early.push(event);
      this.#early.set(key, early);
      const oldest = this.#early.keys().next().value;
      if (this.#early.size > EARLY_KEYS && oldest !== undefined) this.#early.delete(oldest);
      return undefined;
    }
    if (ends(event)) this.#owners.delete(key);
    return owner;
  }

  /** A call's answer names its key: hand back the events that came early, now owned, in order. */
  claim(request: BridgeRequest, response: BridgeResponse, owner: string): BridgeEvent[] {
    const key = claimKey(request, response);
    if (key === undefined) return [];
    this.#owners.set(key, owner);
    const early = this.#early.get(key) ?? [];
    this.#early.delete(key);
    return early.filter((event) => this.route(event, key) !== undefined);
  }

  /** Forget everything `owner` held: its surface went away. */
  drop(owner: string): void {
    for (const [key, holder] of this.#owners) if (holder === owner) this.#owners.delete(key);
  }
}
