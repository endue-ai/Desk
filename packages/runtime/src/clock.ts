/** Time for animations. Inject `ManualClock` in tests so every frame is deterministic. */
export interface Clock {
  now(): number;
  /** Run `callback` on the next frame; returns a function that cancels it. */
  requestFrame(callback: (now: number) => void): () => void;
}

/** How far apart a hidden page's frames are: nobody sees them, and what waits on one still ends. */
export const HIDDEN_FRAME_MS = 50;

/** What `realClock` reads of the page: whether it is hidden, and when that changes. */
export type ClockPage = Pick<Document, "hidden" | "addEventListener">;

/**
 * The browser's clock: performance.now and requestAnimationFrame. A hidden page gets no animation
 * frames (the desk's window closed, #237), so a frame asked for there, or still out when the page
 * goes out of sight, runs on a timer: a tween ends and what waits for it goes on.
 */
export function realClock(page: ClockPage = document): Clock {
  interface Waiting {
    callback: (now: number) => void;
    cancel: () => void;
  }
  const waiting = new Map<number, Waiting>();
  let nextId = 1;
  const schedule = (id: number, callback: (now: number) => void): (() => void) => {
    const run = (now: number) => {
      waiting.delete(id);
      callback(now);
    };
    if (page.hidden) {
      const timer = setTimeout(() => run(performance.now()), HIDDEN_FRAME_MS);
      return () => clearTimeout(timer);
    }
    const handle = requestAnimationFrame(run);
    return () => cancelAnimationFrame(handle);
  };
  // Shown again, the timers still out run within HIDDEN_FRAME_MS: only going out of sight moves frames.
  page.addEventListener("visibilitychange", () => {
    if (!page.hidden) return;
    for (const [id, frame] of waiting) {
      frame.cancel();
      frame.cancel = schedule(id, frame.callback);
    }
  });
  return {
    now: () => performance.now(),
    requestFrame: (callback) => {
      const id = nextId++;
      waiting.set(id, { callback, cancel: schedule(id, callback) });
      return () => {
        waiting.get(id)?.cancel();
        waiting.delete(id);
      };
    },
  };
}

/** A clock that only moves when told to. `advance` runs the frames that were pending. */
export class ManualClock implements Clock {
  #now = 0;
  #nextId = 1;
  readonly #frames = new Map<number, (now: number) => void>();

  now(): number {
    return this.#now;
  }

  requestFrame(callback: (now: number) => void): () => void {
    const id = this.#nextId++;
    this.#frames.set(id, callback);
    return () => this.#frames.delete(id);
  }

  advance(ms: number): void {
    this.#now += ms;
    const due = [...this.#frames.values()];
    this.#frames.clear();
    for (const callback of due) callback(this.#now);
  }
}

export interface Tween {
  from: number;
  to: number;
  durationMs: number;
  ease?: (t: number) => number;
}

/** Interpolate from → to over the duration on `clock`, calling `onUpdate` now and on every frame. */
export function tween(clock: Clock, spec: Tween, onUpdate: (value: number) => void): Promise<void> {
  const ease = spec.ease ?? ((t: number) => t);
  const start = clock.now();
  onUpdate(spec.from);
  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = spec.durationMs <= 0 ? 1 : Math.min(1, (now - start) / spec.durationMs);
      onUpdate(spec.from + (spec.to - spec.from) * ease(t));
      if (t < 1) clock.requestFrame(step);
      else resolve();
    };
    clock.requestFrame(step);
  });
}
