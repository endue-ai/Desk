/**
 * One frame loop on the injected clock for every shell animation. A tick that has nothing to show
 * returns `IDLE`; once every tick does (or none is left), the loop asks for no more frames, so a
 * desk at rest has no frame loop running in its page (ADR 0164), and `wake` (or a new tick) starts it
 * again. A tick that returns nothing keeps it running, as every animation's does.
 */
import type { Clock } from "../clock";

/** What a tick returns when it has nothing to show until something wakes the ticker. */
export const IDLE = "idle";

/** A frame's work: `IDLE` when it has nothing to show, anything else to keep the loop running. */
export type Tick = (now: number) => unknown;

export class Ticker {
  readonly #clock: Clock;
  readonly #ticks = new Set<Tick>();
  #cancel: (() => void) | undefined;
  #now: number;

  constructor(clock: Clock) {
    this.#clock = clock;
    this.#now = clock.now();
    this.#cancel = clock.requestFrame(this.#loop);
  }

  readonly #loop = (now: number): void => {
    this.#now = now;
    this.#cancel = undefined;
    let busy = false;
    for (const tick of [...this.#ticks]) {
      try {
        if (tick(now) !== IDLE) busy = true;
      } catch (error) {
        // One broken part must not stop every other animation on the desk.
        console.error(error);
        busy = true;
      }
    }
    if (busy && !this.#cancel) this.#cancel = this.#clock.requestFrame(this.#loop);
  };

  /** The latest frame's time, so work started from an input event lines up with frames; the
   * clock's own while the loop sleeps. */
  now(): number {
    return this.#cancel ? this.#now : this.#clock.now();
  }

  /** Something changed that a tick shows: the loop runs again from the next frame. */
  wake(): void {
    if (!this.#cancel) this.#cancel = this.#clock.requestFrame(this.#loop);
  }

  add(tick: Tick): () => void {
    this.#ticks.add(tick);
    tick(this.now());
    this.wake();
    return () => this.#ticks.delete(tick);
  }

  /** Run `update(eased 0..1)` over `ms`; resolves when done. `ms` 0 finishes at once. */
  animate(ms: number, ease: (t: number) => number, update: (t: number) => void): Promise<void> {
    const start = this.now();
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
    this.#cancel = undefined;
    this.#ticks.clear();
  }
}
