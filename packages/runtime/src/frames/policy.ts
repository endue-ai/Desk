/**
 * Carrying out which surfaces keep a live frame (ADR 0070, ADR 0134): a surface the set leaves out
 * has its state asked for and its frame taken away; one the set lets back in loads again. The set
 * is decided elsewhere: by the window manager's live budget in the app (crates/desk-wm
 * `LiveBudget`, ADR 0151, #83), and on a desk without one every window stays live. The surface the
 * keys go to never is unloaded. Asking for the state and taking the frame away are the caller's
 * `unload`.
 */

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
  /** Whether surface `id` keeps a live frame now. */
  live(id: string): boolean;
  /** The surface the keys go to. */
  focused(): string | null;
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

/** The frames counted, for the inspector: loaded and kept, loaded and leaving, and asleep. */
export interface FrameCounts {
  shown: number;
  hidden: number;
  asleep: number;
}

interface Entry {
  phase: Phase;
  /** Not to be unloaded again before this time. */
  heldUntil: number;
  /** Let back in or woken while its state was asked: keep it. */
  cancelled: boolean;
}

export class FramePolicy {
  readonly #deps: PolicyDeps;
  readonly #entries = new Map<string, Entry>();
  #cancelTimer: (() => void) | undefined;
  #disposed = false;

  constructor(deps: PolicyDeps) {
    this.#deps = deps;
  }

  /** Count a surface in: it just opened. `check` looks at it next. */
  track(id: string): void {
    if (this.#entries.has(id)) return;
    this.#entries.set(id, { phase: "live", heldUntil: 0, cancelled: false });
  }

  untrack(id: string): void {
    this.#entries.delete(id);
  }

  unloaded(id: string): boolean {
    return this.#entries.get(id)?.phase === "unloaded";
  }

  /**
   * Load an unloaded frame again, kept or not (something needs its answer). True when its frame is
   * live after: loaded now, or already. False for one being unloaded or not counted in.
   */
  wake(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry?.phase === "unloading") entry.cancelled = true;
    if (entry?.phase === "unloaded") {
      this.#remount(id, entry);
      this.check();
    }
    return entry?.phase === "live";
  }

  /** Look at every surface again: what the set keeps loads, what it leaves out goes. */
  check(): void {
    if (this.#disposed) return;
    const now = this.#deps.timers.now();
    for (const [id, entry] of this.#entries) {
      if (this.#kept(id)) {
        if (entry.phase === "unloaded") this.#remount(id, entry);
        if (entry.phase === "unloading") entry.cancelled = true;
      } else if (entry.phase === "live" && entry.heldUntil <= now) {
        this.#unload(id, entry);
      }
    }
    this.#schedule(now);
  }

  /** How many frames are loaded and kept, loaded and left out, and asleep. */
  counts(): FrameCounts {
    const counts = { shown: 0, hidden: 0, asleep: 0 };
    for (const [id, entry] of this.#entries) {
      if (entry.phase === "unloaded") counts.asleep++;
      else if (this.#kept(id)) counts.shown++;
      else counts.hidden++;
    }
    return counts;
  }

  dispose(): void {
    this.#disposed = true;
    this.#cancelTimer?.();
    this.#entries.clear();
  }

  #kept(id: string): boolean {
    return this.#deps.live(id) || this.#deps.focused() === id;
  }

  #remount(id: string, entry: Entry): void {
    entry.phase = "live";
    this.#deps.remount(id);
  }

  #unload(id: string, entry: Entry): void {
    entry.phase = "unloading";
    entry.cancelled = false;
    const still = () => this.#entries.get(id) === entry && !entry.cancelled && !this.#kept(id);
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

  /** Wake for a held one's retry. */
  #schedule(now: number): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    let next = Number.POSITIVE_INFINITY;
    for (const [id, entry] of this.#entries) {
      if (entry.phase === "live" && !this.#kept(id) && entry.heldUntil > now)
        next = Math.min(next, entry.heldUntil);
    }
    if (next === Number.POSITIVE_INFINITY) return;
    this.#cancelTimer = this.#deps.timers.after(Math.max(0, next - now), () => this.check());
  }
}
