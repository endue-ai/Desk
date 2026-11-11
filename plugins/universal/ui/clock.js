// The clock a drawn view's items queries read ({now}, {today}, {tomorrow}, {yesterday}): the live
// one, until a calendar of the view is paged to another day. Then the queries read that day, so the
// days a person pages to show their own entries, not today's; Today brings the live clock back.

/**
 * @typedef {import("../../../packages/bridge/src/index").UniversalView} UniversalView
 * @typedef {import("../../../packages/bridge/src/index").UniversalPage} UniversalPage
 */

const CLOCK = /\{(now|today|tomorrow|yesterday)\}/;
const two = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** A day as the calendar names it, YYYY-MM-DD, in this computer's zone. */
export function dayOf(/** @type {number} */ ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * Whether an items query of the view, or of one of a page's sections, reads the clock.
 * @param {UniversalView | UniversalPage | undefined} view
 * @returns {boolean}
 */
export function readsClock(view) {
  if (!view) return false;
  if ("sections" in view) return view.sections.some(readsClock);
  const source = view.source;
  if (!source || !("items" in source)) return false;
  const reads = (/** @type {unknown} */ value) =>
    typeof value === "string"
      ? CLOCK.test(value)
      : Array.isArray(value) && value.some((each) => reads(each));
  return (source.items.where ?? []).some((c) => "value" in c && reads(c.value));
}

/** @param {() => number} [live] the live clock */
export function createClock(live = Date.now) {
  /** @type {string | undefined} the day a calendar was paged to; undefined: the live clock */
  let day;
  return {
    /** The time the queries read: noon of the day paged to, or now. */
    now() {
      if (!day) return live();
      const [y, m, d] = day.split("-").map(Number);
      return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).getTime();
    },
    /** Follow a calendar to `anchor` (YYYY-MM-DD); whether the clock moved. */
    move(/** @type {string} */ anchor) {
      const next =
        /^\d{4}-\d{2}-\d{2}$/.test(anchor) && anchor !== dayOf(live()) ? anchor : undefined;
      if (next === day) return false;
      day = next;
      return true;
    },
    /** The live clock again, for the next view. */
    reset() {
      day = undefined;
    },
  };
}
