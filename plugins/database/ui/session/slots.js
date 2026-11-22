// How many PostgreSQL sessions the plugin holds at once, under the core's 16 a caller (ADR 0281):
// the sessions consoles and table views keep (twelve at most, PG-02) and the short ones a run of the
// plugin's own opens and closes (twelve at once at most), never more than sixteen together. A short
// run waits for a slot; a kept session waits only while short runs fill the rest. Waiters of a kind
// go in order. No DOM.

/** The core's sessions a caller (ADR 0281). */
export const CORE_SESSIONS = 16;
/** Short runs at once. */
export const RUNS_AT_ONCE = 12;
/** Sessions consoles and table views keep, so four stay for short runs. */
export const KEPT_MAX = 12;

/** @typedef {"short" | "kept"} Kind */

export function createSlots() {
  const held = { short: 0, kept: 0 };
  /** @type {Array<{ kind: Kind, go(): void }>} */
  const waiting = [];
  const fits = (/** @type {Kind} */ kind) =>
    held.short + held.kept < CORE_SESSIONS &&
    (kind === "kept" ? held.kept < KEPT_MAX : held.short < RUNS_AT_ONCE);
  const wake = () => {
    for (let i = 0; i < waiting.length; ) {
      const next = waiting[i];
      if (next && fits(next.kind)) {
        waiting.splice(i, 1);
        held[next.kind]++;
        next.go();
      } else i++;
    }
  };
  return {
    /** A slot of `kind`: at once when one is free and none of its kind waits, else in turn. */
    take(/** @type {Kind} */ kind) {
      if (fits(kind) && !waiting.some((w) => w.kind === kind)) {
        held[kind]++;
        return Promise.resolve();
      }
      return new Promise((go) => waiting.push({ kind, go: () => go(undefined) }));
    },
    give(/** @type {Kind} */ kind) {
      held[kind] = Math.max(0, held[kind] - 1);
      wake();
    },
  };
}
