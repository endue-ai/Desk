/** One frame loop on the injected clock for every shell animation. */
import type { Clock } from "../clock";

export type Tick = (now: number) => void;

export class Ticker {
  readonly #clock: Clock;
  readonly #ticks = new Set<Tick>();
  #cancel: (() => void) | undefined;
  #now: number;

  constructor(clock: Clock) {
    this.#clock = clock;
    this.#now = clock.now();
    const loop = (now: number) => {
      this.#now = now;
      for (const tick of [...this.#ticks]) {
        try {
          tick(now);
        } catch (error) {
          // One broken part must not stop every other animation on the desk.
          console.error(error);
        }
      }
      this.#cancel = this.#clock.requestFrame(loop);
    };
    this.#cancel = clock.requestFrame(loop);
  }

  /** The latest frame's time, so work started from an input event lines up with frames. */
  now(): number {
    return this.#now;
  }

  add(tick: Tick): () => void {
    this.#ticks.add(tick);
    tick(this.#now);
    return () => this.#ticks.delete(tick);
  }

  /** Run `update(eased 0..1)` over `ms`; resolves when done. `ms` 0 finishes at once. */
  animate(ms: number, ease: (t: number) => number, update: (t: number) => void): Promise<void> {
    const start = this.#now;
    return new Promise((resolve) => {
      const remove = this.add((now) => {
        const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms);
        update(ease(t));
        if (t >= 1) {
          remove();
          resolve();
        }
      });
    });
  }

  dispose(): void {
    this.#cancel?.();
    this.#ticks.clear();
  }
}
