// How much of a flood the terminal lets through (ADR 0113): five a tab and ten a desk in any ten
// seconds; the rest are counted, and the next one that goes out from that tab says how many were
// held back. Notices (notices.js) and event commands (hooks.js) each keep one. No DOM.

/** The rate limit: so many a tab, and a desk, in a window of this many ms. */
export const WINDOW_MS = 10_000;
export const PER_TAB = 5;
export const PER_DESK = 10;

/** @param {() => number} now */
export function createFlood(now) {
  /** Per tab, when its messages went out; and the desk's. @type {Map<string, number[]>} */
  const sent = new Map();
  let desk = /** @type {number[]} */ ([]);
  /** @type {Map<string, number>} */
  const held = new Map();
  return {
    /** Whether one more from the tab `id` goes out now: null when held back, else how many were. */
    admit(/** @type {string} */ id) {
      const at = now();
      const mine = (sent.get(id) ?? []).filter((when) => at - when < WINDOW_MS);
      desk = desk.filter((when) => at - when < WINDOW_MS);
      sent.set(id, mine);
      if (mine.length >= PER_TAB || desk.length >= PER_DESK) {
        held.set(id, (held.get(id) ?? 0) + 1);
        return null;
      }
      mine.push(at);
      desk.push(at);
      const more = held.get(id) ?? 0;
      held.delete(id);
      return more;
    },
    forget(/** @type {string} */ id) {
      sent.delete(id);
      held.delete(id);
    },
  };
}
