/**
 * When the runtime unloads a surface's frame (ADR 0070): once it has not been visible for
 * desk.display.unload-after, or at once when it falls out of the live budget (`live-budget.ts`, ADR
 * 0134): of the surfaces out of sight, only the desk.surfaces.live most recently focused keep a
 * frame. A visible surface, or the one the keys go to, never is unloaded; an unloaded one loads again
 * as soon as it shows. Only decisions here: asking for the state and taking the frame away are the
 * caller's `unload`.
 */
import { type Counted, FocusOrder, liveBudget } from "./live-budget";

/** Time for the policy: `setTimeout` and `performance.now` by default, a manual one in tests. */
export interface FrameTimers {
  now(): number;
  /** Run `run` in `ms`; returns a function that cancels it. */
  after(ms: number, run: () => void): () => void;
}

export const realTimers: FrameTimers = {
  now: () => performance.now(),
  after: (ms, run) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
};

export interface PolicyDeps {
  visible(id: string): boolean;
  /** The surface the keys go to. */
  focused(): string | null;
  /** How long a surface may stay hidden and loaded, in ms; 0 keeps it loaded. */
  afterMs(): number;
  /** How many frames out of sight may stay live (desk.surfaces.live); 0 keeps none. */
  budget(): number;
  /**
   * Ask for the state and take the frame away, unless `still()` says no by then; resolves true when
   * the frame is gone.
   */
  unload(id: string, still: () => boolean): Promise<boolean>;
  remount(id: string): void;
  timers: FrameTimers;
}

/** A refused unload (the desk waits for the plugin's answer, say) is tried again this much later. */
export const RETRY_MS = 1000;

type Phase = "live" | "unloading" | "unloaded";

/** The frames counted, for the inspector: loaded in sight, loaded out of sight, and asleep. */
export interface FrameCounts {
  shown: number;
  hidden: number;
  asleep: number;
}

interface Entry {
  phase: Phase;
  /** When it stopped being visible; undefined while it is. */
  hiddenSince: number | undefined;
  /** Not to be unloaded again before this time. */
  heldUntil: number;
  /** Shown or woken while its state was asked: keep it. */
  cancelled: boolean;
}

export class FramePolicy {
  readonly #deps: PolicyDeps;
  readonly #entries = new Map<string, Entry>();
  readonly #order = new FocusOrder();
  #cancelTimer: (() => void) | undefined;
  #disposed = false;

  constructor(deps: PolicyDeps) {
    this.#deps = deps;
  }

  /** Count a surface in, as the most recent: it just opened. `check` looks at it next. */
  track(id: string): void {
    if (this.#entries.has(id)) return;
    this.#order.touch(id);
    this.#entries.set(id, {
      phase: "live",
      hiddenSince: undefined,
      heldUntil: 0,
      cancelled: false,
    });
  }

  /** The keys went to `id`: it is the most recent. `check` wakes it if it sleeps. */
  focused(id: string): void {
    if (this.#entries.has(id)) this.#order.touch(id);
  }

  untrack(id: string): void {
    this.#entries.delete(id);
    this.#order.forget(id);
  }

  unloaded(id: string): boolean {
    return this.#entries.get(id)?.phase === "unloaded";
  }

  /**
   * Load an unloaded frame again, visible or not (something needs its answer), as the most recent:
   * it is in use. True when its frame is live after: loaded now, or already. False for one being
   * unloaded or not counted in.
   */
  wake(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry) this.#order.touch(id);
    if (entry?.phase === "unloading") entry.cancelled = true;
    if (entry?.phase === "unloaded") {
      this.#remount(id, entry);
      this.check();
    }
    return entry?.phase === "live";
  }

  /**
   * Look at every surface again: what shows loads, what hid too long goes, and past the budget the
   * least recently focused out of sight go. The surface with the keys counts as focused now.
   */
  check(): void {
    if (this.#disposed) return;
    const now = this.#deps.timers.now();
    const focused = this.#deps.focused();
    if (focused !== null && this.#entries.has(focused)) this.#order.touch(focused);
    for (const [id, entry] of this.#entries) {
      if (this.#shown(id)) entry.hiddenSince = undefined;
      else entry.hiddenSince ??= now;
    }
    const after = this.#deps.afterMs();
    if (after > 0) {
      for (const [id, entry] of this.#entries) {
        if (this.#ready(entry, now) && now - (entry.hiddenSince ?? now) >= after)
          this.#unload(id, entry);
      }
    }
    const { wake, sleep } = liveBudget(this.#counted(now), this.#deps.budget());
    for (const id of wake) {
      const entry = this.#entries.get(id);
      if (entry?.phase === "unloaded") this.#remount(id, entry);
      if (entry?.phase === "unloading") entry.cancelled = true;
    }
    for (const id of sleep) {
      const entry = this.#entries.get(id);
      if (entry) this.#unload(id, entry);
    }
    this.#schedule(now, after);
  }

  /** How many frames are loaded in sight and out of it, and how many asleep. */
  counts(): FrameCounts {
    const counts = { shown: 0, hidden: 0, asleep: 0 };
    for (const [id, entry] of this.#entries) {
      if (entry.phase === "unloaded") counts.asleep++;
      else if (this.#shown(id)) counts.shown++;
      else counts.hidden++;
    }
    return counts;
  }

  dispose(): void {
    this.#disposed = true;
    this.#cancelTimer?.();
    this.#entries.clear();
  }

  /** Live, out of sight and not held after a refused unload. */
  #ready(entry: Entry, now: number): boolean {
    return entry.phase === "live" && entry.hiddenSince !== undefined && entry.heldUntil <= now;
  }

  /** Every surface, most recently focused first, as the budget counts it. */
  #counted(now: number): Counted[] {
    return this.#order.sort(this.#entries.keys()).map((id) => {
      const entry = this.#entries.get(id) as Entry;
      return {
        id,
        shown: entry.hiddenSince === undefined,
        live: entry.phase === "live",
        ready: entry.heldUntil <= now,
      };
    });
  }

  #shown(id: string): boolean {
    return this.#deps.visible(id) || this.#deps.focused() === id;
  }

  #remount(id: string, entry: Entry): void {
    entry.phase = "live";
    entry.hiddenSince = this.#shown(id) ? undefined : this.#deps.timers.now();
    this.#deps.remount(id);
  }

  #unload(id: string, entry: Entry): void {
    entry.phase = "unloading";
    entry.cancelled = false;
    const still = () => this.#entries.get(id) === entry && !entry.cancelled && !this.#shown(id);
    void this.#deps.unload(id, still).then(
      (gone) => this.#settled(id, entry, gone),
      () => this.#settled(id, entry, false),
    );
  }

  #settled(id: string, entry: Entry, gone: boolean): void {
    if (this.#entries.get(id) !== entry) return;
    entry.phase = gone ? "unloaded" : "live";
    if (!gone) entry.heldUntil = this.#deps.timers.now() + RETRY_MS;
    this.check();
  }

  /** Wake for the next surface whose time runs out, or a held one's retry. */
  #schedule(now: number, after: number): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    let next = Number.POSITIVE_INFINITY;
    for (const entry of this.#entries.values()) {
      if (entry.phase !== "live" || entry.hiddenSince === undefined) continue;
      if (entry.heldUntil > now) next = Math.min(next, entry.heldUntil);
      else if (after > 0) next = Math.min(next, entry.hiddenSince + after);
    }
    if (next === Number.POSITIVE_INFINITY) return;
    this.#cancelTimer = this.#deps.timers.after(Math.max(0, next - now), () => this.check());
  }
}
