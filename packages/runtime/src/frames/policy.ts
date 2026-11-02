/**
 * When the runtime unloads a surface's frame (ADR 0070): once it has not been visible for
 * desk.display.unload-after, or at once for the one hidden longest while more frames are live than
 * desk.display.live-surfaces allows. A visible surface, or the one the keys go to, never is; an
 * unloaded one loads again as soon as it shows. Only decisions here: asking for the state and taking
 * the frame away are the caller's `unload`.
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
  visible(id: string): boolean;
  /** The surface the keys go to. */
  focused(): string | null;
  /** How long a surface may stay hidden and loaded, in ms; 0 keeps it loaded. */
  afterMs(): number;
  /** How many frames may be live; 0 sets no limit. */
  limit(): number;
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
  #cancelTimer: (() => void) | undefined;
  #disposed = false;

  constructor(deps: PolicyDeps) {
    this.#deps = deps;
  }

  /** Count a surface in; `check` looks at it next. */
  track(id: string): void {
    if (this.#entries.has(id)) return;
    this.#entries.set(id, {
      phase: "live",
      hiddenSince: undefined,
      heldUntil: 0,
      cancelled: false,
    });
  }

  untrack(id: string): void {
    this.#entries.delete(id);
  }

  unloaded(id: string): boolean {
    return this.#entries.get(id)?.phase === "unloaded";
  }

  /** Load an unloaded frame again, visible or not (something needs its answer); true when it was. */
  wake(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry?.phase === "unloading") entry.cancelled = true;
    if (entry?.phase !== "unloaded") return false;
    this.#remount(id, entry);
    this.check();
    return true;
  }

  /** Look at every surface again: what shows loads, what hid too long or too many goes. */
  check(): void {
    if (this.#disposed) return;
    const now = this.#deps.timers.now();
    for (const [id, entry] of this.#entries) {
      if (this.#shown(id)) {
        entry.hiddenSince = undefined;
        if (entry.phase === "unloaded") this.#remount(id, entry);
        if (entry.phase === "unloading") entry.cancelled = true;
      } else if (entry.hiddenSince === undefined) entry.hiddenSince = now;
    }
    const after = this.#deps.afterMs();
    const ready = (entry: Entry) =>
      entry.phase === "live" && entry.hiddenSince !== undefined && entry.heldUntil <= now;
    if (after > 0) {
      for (const [id, entry] of this.#entries) {
        if (ready(entry) && now - (entry.hiddenSince ?? now) >= after) this.#unload(id, entry);
      }
    }
    const limit = this.#deps.limit();
    if (limit > 0) {
      const live = [...this.#entries.values()].filter((e) => e.phase === "live").length;
      const oldest = [...this.#entries]
        .filter(([, entry]) => ready(entry))
        .sort(([, a], [, b]) => (a.hiddenSince ?? 0) - (b.hiddenSince ?? 0));
      for (const [id, entry] of oldest.slice(0, Math.max(0, live - limit))) this.#unload(id, entry);
    }
    this.#schedule(now, after);
  }

  dispose(): void {
    this.#disposed = true;
    this.#cancelTimer?.();
    this.#entries.clear();
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
