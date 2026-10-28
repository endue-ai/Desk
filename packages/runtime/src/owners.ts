import type {
  AudioCaptureStartResult,
  BrainSayResult,
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  FsWatchResult,
  ProcSpawnResult,
} from "@endue-ai/bridge";

/** How many unclaimed keys keep their early events. */
const EARLY_KEYS = 32;

/** The key an owned event belongs to, or undefined for events every holder may see. */
export function eventKey(event: BridgeEvent): string | undefined {
  switch (event.event) {
    case "brain.turn":
      return `turn:${event.data.turnId}`;
    case "fs.changed":
      return `watch:${event.data.watchId}`;
    case "proc.output":
    case "proc.exit":
      return `proc:${event.data.procId}`;
    case "audio.wake":
      return `capture:${event.data.captureId}`;
    default:
      return undefined;
  }
}

/** The key a successful call starts: its events go to the caller that made it. */
export function claimKey(request: BridgeRequest, response: BridgeResponse): string | undefined {
  if (!response.ok) return undefined;
  switch (request.method) {
    case "brain.say":
      return `turn:${(response.result as BrainSayResult).turnId}`;
    case "fs.watch":
      return `watch:${(response.result as FsWatchResult).watchId}`;
    case "proc.spawn":
      return `proc:${(response.result as ProcSpawnResult).procId}`;
    case "audio.capture.start":
      return `capture:${(response.result as AudioCaptureStartResult).captureId}`;
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

/**
 * Routes owned events (turns, watches, processes, captures) to the plugin whose call started them.
 * Events that arrive before the call's answer names their key wait for it.
 */
export class Owners {
  readonly #owners = new Map<string, string>();
  readonly #early = new Map<string, BridgeEvent[]>();

  /**
   * The plugin an owned event goes to. Undefined when nobody owns it (yet): the event is kept
   * until a claim, or dropped once too many keys wait.
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

  /** A call's answer names its key: hand back the events that came early, now owned. */
  claim(request: BridgeRequest, response: BridgeResponse, owner: string): BridgeEvent[] {
    const key = claimKey(request, response);
    if (key === undefined) return [];
    this.#owners.set(key, owner);
    const early = this.#early.get(key) ?? [];
    this.#early.delete(key);
    return early.filter((event) => this.route(event, key) !== undefined);
  }

  /** Forget everything `owner` held (its surface went away). */
  drop(owner: string): void {
    for (const [key, holder] of this.#owners) if (holder === owner) this.#owners.delete(key);
  }
}
