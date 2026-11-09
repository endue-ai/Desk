/**
 * The live budget (#37, ADR 0134): which surfaces keep a live frame. Every one in sight, or with the
 * keys, does; of those out of sight, the N most recently focused do (`desk.surfaces.live`). The rest
 * sleep: their frame is unloaded and their state kept (ADR 0070), and one that shows again wakes.
 * Edge bars, overlays and the system layer are never counted. Decisions only: the frame policy
 * (`policy.ts`) carries them out.
 */

/** Surfaces by focus, most recent first: the order the budget keeps them in when it must choose. */
export class FocusOrder {
  #ids: string[] = [];

  /** `id` was focused, opened or woken for an answer: it is the most recent now. */
  touch(id: string): void {
    if (this.#ids[0] === id) return;
    this.#ids = [id, ...this.#ids.filter((other) => other !== id)];
  }

  forget(id: string): void {
    this.#ids = this.#ids.filter((other) => other !== id);
  }

  /** `ids` most recent first; ones never touched go last, in the order given. */
  sort(ids: Iterable<string>): string[] {
    const rank = new Map(this.#ids.map((id, i) => [id, i]));
    const given = [...ids];
    const after = new Map(given.map((id, i) => [id, this.#ids.length + i]));
    const at = (id: string) => rank.get(id) ?? after.get(id) ?? 0;
    return given.sort((a, b) => at(a) - at(b));
  }
}

/** One surface the budget counts. */
export interface Counted {
  id: string;
  /** In sight, or the surface the keys go to. */
  shown: boolean;
  /** Its frame is loaded: neither asleep nor being put to sleep. */
  live: boolean;
  /** It may be put to sleep now: not while a refused unload waits to be tried again. */
  ready: boolean;
}

export interface Decisions {
  /** Shown but asleep, or going to sleep: load them again. */
  wake: string[];
  /** Live and out of sight past the budget, least recent first: put them to sleep. */
  sleep: string[];
}

/**
 * The decisions for `surfaces`, most recent first, when `budget` live frames may stay out of sight
 * (its floor; 0 or less keeps only what is in sight). Only live frames count against it; one that
 * may not sleep yet is passed over for the next least recent.
 */
export function liveBudget(surfaces: readonly Counted[], budget: number): Decisions {
  const wake = surfaces.filter((s) => s.shown && !s.live).map((s) => s.id);
  const hidden = surfaces.filter((s) => !s.shown && s.live);
  const kept = Number.isNaN(budget) ? 0 : Math.max(0, Math.floor(budget));
  const over = hidden.length - kept;
  if (over <= 0) return { wake, sleep: [] };
  const sleep = hidden
    .filter((s) => s.ready)
    .reverse()
    .slice(0, over)
    .map((s) => s.id);
  return { wake, sleep };
}
