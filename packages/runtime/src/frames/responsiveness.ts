/**
 * Whether each plugin frame still answers the desk (#39, #32 §9): the model alone, apart from the
 * window that shows it (`surface/not-responding.ts`), so Stage 1 (#44) can swap the pings for the
 * renderer's own hang and death signals. From its hello, the runtime pings a live frame every 2 s and
 * the SDK answers each ping by itself (`desk:pong`). A frame is watched once it has answered: watched
 * and 5 s without an answer, it is `late` and its window asks Wait or Stop. Wait asks again 10 s later
 * unless it answered meanwhile; Stop makes it `stopped` until the person loads it again. A frame that
 * leaves its first pings unanswered has an SDK from before them: it is not pinged again until its next
 * hello. A ping always gets one interval to be answered, so a desk that slept does not count the gap.
 */
import type { FrameTimers } from "./policy";

/** How often a live frame is pinged. */
export const PING_MS = 2000;
/** How long a watched frame may go without answering before its window says so. */
export const LATE_MS = 5000;
/** How much longer Wait gives it before the window asks again. */
export const WAIT_MS = 10_000;
/** How many pings a frame may leave unanswered before it has answered one, then it is let be. */
export const FIRST_PINGS = 3;

/**
 * `responding`: it answers, or is not watched yet; `late`: watched and 5 s without an answer;
 * `stopped`: the person stopped it, and it stays unloaded until they load it again.
 */
export type Responsiveness = "responding" | "late" | "stopped";

/** What a surface's window shows of its frame. */
export interface Response {
  state: Responsiveness;
  /** It answered a ping since it last loaded: only a watched frame is judged. */
  watched: boolean;
  /** Late and not waited on: the window asks Wait or Stop now. */
  asking: boolean;
}

export interface ResponsivenessDeps {
  timers: FrameTimers;
  /** Whether surface `id` has a frame the desk may ping: on the page, and it said hello. */
  live(id: string): boolean;
  /** Post ping `n` to surface `id`'s frame. */
  ping(id: string, n: number): void;
}

interface Entry extends Response {
  /** Pinged: it said hello since it loaded, and has answered or still may. */
  pinged: boolean;
  /** Pings it left unanswered before its first answer. */
  unanswered: number;
  /** When it last answered, or when its watch (re)started. */
  heard: number;
  /** When the oldest ping it has not answered went out. */
  waiting: number | undefined;
  /** Cancels its one pending timer: the late deadline, or the end of a wait. */
  cancel: (() => void) | undefined;
}

type Listener = (id: string, response: Response) => void;

const view = (e: Response): Response => ({ state: e.state, watched: e.watched, asking: e.asking });
const same = (a: Response, b: Response) =>
  a.state === b.state && a.watched === b.watched && a.asking === b.asking;

export class ResponsivenessModel {
  readonly #deps: ResponsivenessDeps;
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<Listener>();
  #next = 1;
  #cancelTick: (() => void) | undefined;

  constructor(deps: ResponsivenessDeps) {
    this.#deps = deps;
  }

  /** Count surface `id` in: its frame is pinged from its first hello. */
  track(id: string): void {
    if (this.#entries.has(id)) return;
    this.#entries.set(id, {
      state: "responding",
      watched: false,
      asking: false,
      pinged: false,
      unanswered: 0,
      heard: this.#deps.timers.now(),
      waiting: undefined,
      cancel: undefined,
    });
  }

  untrack(id: string): void {
    this.#entries.get(id)?.cancel?.();
    this.#entries.delete(id);
  }

  ids(): string[] {
    return [...this.#entries.keys()];
  }

  get(id: string): Response | undefined {
    const entry = this.#entries.get(id);
    return entry && view(entry);
  }

  /** Surface `id`'s frame said hello: a new page, pinged from now on and watched once it answers. */
  hello(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry || entry.state === "stopped") return;
    this.#restart(id, entry);
    entry.pinged = true;
    this.#schedule();
  }

  /** Surface `id`'s frame answered a ping: it is watched, and responding again if it was late. */
  answered(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry || entry.state === "stopped") return;
    this.#change(id, entry, () => {
      this.#clear(entry);
      entry.heard = this.#deps.timers.now();
      entry.watched = true;
      entry.pinged = true;
      entry.state = "responding";
    });
    this.#schedule();
  }

  /** Wait: the window stops asking for 10 s, then asks again unless the frame answered. */
  wait(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry?.state !== "late" || !entry.asking) return false;
    this.#change(id, entry, () => {
      entry.cancel?.();
      entry.asking = false;
      entry.cancel = this.#deps.timers.after(WAIT_MS, () => {
        entry.cancel = undefined;
        if (this.#entries.get(id) === entry && entry.state === "late")
          this.#change(id, entry, () => {
            entry.asking = true;
          });
      });
    });
    return true;
  }

  /** Stop a late frame: `stopped` until `reload`; taking the frame away is the caller's. */
  stop(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry?.state !== "late") return false;
    this.#change(id, entry, () => {
      this.#clear(entry);
      entry.watched = false;
      entry.pinged = false;
      entry.state = "stopped";
    });
    return true;
  }

  /** Its renderer died (the shell says so): `stopped`, whatever it was, until `reload`. */
  crash(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry || entry.state === "stopped") return false;
    this.#change(id, entry, () => {
      this.#clear(entry);
      entry.watched = false;
      entry.pinged = false;
      entry.state = "stopped";
    });
    return true;
  }

  /** A stopped frame loads again: responding, pinged from its hello and watched once it answers. */
  reload(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry?.state !== "stopped") return false;
    this.#change(id, entry, () => {
      entry.state = "responding";
    });
    return true;
  }

  /** Hear every change of a surface's response; returns a function that stops. */
  onChange(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    for (const entry of this.#entries.values()) entry.cancel?.();
    this.#entries.clear();
    this.#listeners.clear();
    this.#cancelTick?.();
    this.#cancelTick = undefined;
  }

  /** Every interval: ping each frame that is pinged; one no longer live waits for its next hello. */
  #tick(): void {
    this.#cancelTick = undefined;
    const now = this.#deps.timers.now();
    for (const [id, entry] of this.#entries) {
      if (!entry.pinged) continue;
      if (!this.#deps.live(id)) {
        this.#restart(id, entry);
        continue;
      }
      if (!entry.watched && entry.unanswered >= FIRST_PINGS) {
        entry.pinged = false;
        continue;
      }
      this.#deps.ping(id, this.#next++);
      if (!entry.watched) entry.unanswered++;
      if (entry.waiting !== undefined) continue;
      entry.waiting = now;
      if (!entry.watched || entry.state !== "responding") continue;
      // 5 s since it last answered, and never before this ping has had one interval.
      const due = Math.max(entry.heard + LATE_MS, now + PING_MS);
      entry.cancel?.();
      entry.cancel = this.#deps.timers.after(due - now, () => this.#late(id, entry));
    }
    this.#schedule();
  }

  /** Start over, unwatched and unpinged: its frame went away or loaded a new page. */
  #restart(id: string, entry: Entry): void {
    this.#change(id, entry, () => {
      this.#clear(entry);
      entry.heard = this.#deps.timers.now();
      entry.watched = false;
      entry.pinged = false;
      entry.unanswered = 0;
      entry.state = "responding";
    });
  }

  #late(id: string, entry: Entry): void {
    entry.cancel = undefined;
    if (this.#entries.get(id) !== entry || entry.waiting === undefined) return;
    this.#change(id, entry, () => {
      entry.state = "late";
      entry.asking = true;
    });
  }

  #clear(entry: Entry): void {
    entry.cancel?.();
    entry.cancel = undefined;
    entry.waiting = undefined;
    entry.asking = false;
  }

  #change(id: string, entry: Entry, apply: () => void): void {
    const before = view(entry);
    apply();
    const after = view(entry);
    if (same(before, after)) return;
    for (const listener of [...this.#listeners]) listener(id, after);
  }

  /** The next tick, while any frame is pinged; none runs while every frame is let be. */
  #schedule(): void {
    if (this.#cancelTick || ![...this.#entries.values()].some((e) => e.pinged)) return;
    this.#cancelTick = this.#deps.timers.after(PING_MS, () => this.#tick());
  }
}
