// The question's arming delay (PG-01g, ADR 0335): a card that comes up while the person types in a
// plugin must not take the next key as its answer. For ARM_MS after a card shows, keys answer
// nothing (Tab still moves the focus), and a key pressed then stays swallowed until it is released,
// so its keyup or the click it makes cannot press a button after the delay either. A pointer press
// (or a script's click) answers at once. No DOM: the view asks with each key event.

/** How long after a card shows its keys answer nothing. */
export const ARM_MS = 500;

/** @param {{ now?(): number }} [options] */
export function createArming(options = {}) {
  const now = options.now ?? (() => performance.now());
  let since = Number.NEGATIVE_INFINITY;
  /** Keys pressed while the card was not armed, until they are released. */
  const held = new Set();
  const armed = () => now() - since >= ARM_MS;
  return {
    /** A card showed: its keys answer nothing for a moment. */
    start() {
      since = now();
      held.clear();
    },
    armed,
    /**
     * Whether a key event must go nowhere.
     * @param {"keydown" | "keyup"} type
     * @param {string} key
     */
    swallows(type, key) {
      if (key === "Tab") return false;
      if (type === "keyup") return held.delete(key);
      if (armed() && !held.has(key)) return false;
      held.add(key);
      return true;
    },
    /** Whether a click a swallowed key makes (detail 0, the key still down) must answer nothing; a
     * pointer's, or a script's, answers. */
    ignores(/** @type {number} */ detail) {
      return detail === 0 && held.size > 0;
    },
  };
}
