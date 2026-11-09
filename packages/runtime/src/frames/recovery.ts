/**
 * What the desk does when a plugin frame's renderer dies (#44, #32 §9): the first death reloads the
 * window by itself with its last desk:state; a second within a minute holds it stopped for the rest
 * of this run, until the person reloads it. ADR 0061's quarantine is for starts; this one lasts the
 * run and is never written down.
 */

/** How long a second death counts as the same trouble. */
export const AGAIN_MS = 60_000;

export type Verdict = "reload" | "hold";

export class CrashRecovery {
  readonly #now: () => number;
  readonly #last = new Map<string, number>();
  readonly #held = new Set<string>();

  constructor(now: () => number) {
    this.#now = now;
  }

  /** `id`'s renderer died: reload it, or hold it stopped. */
  crashed(id: string): Verdict {
    const now = this.#now();
    const last = this.#last.get(id);
    this.#last.set(id, now);
    if (this.#held.has(id) || (last !== undefined && now - last < AGAIN_MS)) {
      this.#held.add(id);
      return "hold";
    }
    return "reload";
  }

  /** Whether `id` is held for this run. */
  held(id: string): boolean {
    return this.#held.has(id);
  }

  /** The person reloaded `id`: it gets one automatic reload again. */
  released(id: string): void {
    this.#held.delete(id);
    this.#last.delete(id);
  }
}
