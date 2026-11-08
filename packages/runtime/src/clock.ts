/** Time for animations. Inject `ManualClock` in tests so every frame is deterministic. */
export interface Clock {
  now(): number;
  /** Run `callback` on the next frame; returns a function that cancels it. */
  requestFrame(callback: (now: number) => void): () => void;
}

/** The browser's clock: performance.now and requestAnimationFrame. */
export function realClock(): Clock {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => {
      const handle = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(handle);
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
