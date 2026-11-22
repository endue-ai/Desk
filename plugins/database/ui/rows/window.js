// The rows a console holds of a read its cursor keeps (PG-22, ADR 0352): a window of pages over the
// whole result. A page asked for after the last row held or before the first comes in at that end,
// and pages far from it are let go, so the window holds at most HOLD_PAGES pages and HOLD_BYTES of
// values; rows let go are fetched again when the person scrolls back. The count is "at least" until
// the end is reached. Pure.

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../engines/common.js").Window} Window
 * @typedef {"next" | "back"} Way
 * @typedef {{ rows: (string | null)[][], done: boolean, total?: number }} Fetched
 */

export const HOLD_PAGES = 4;
export const HOLD_BYTES = 32 * 1024 * 1024;
/** The rows the window may hold whatever its page, so a small page still fills a screen or two. */
export const HOLD_ROWS = 2000;

/** Whether a set holds every row of its result: no cursor, or one read to its end and all held. */
export const whole = (/** @type {ResultSet} */ set) => {
  const w = set.window;
  return !w || (w.done && w.first === 0 && set.rows.length >= w.known);
};

/** The rows to ask for to go `way`, or undefined at that end. */
export function askFor(/** @type {ResultSet} */ set, /** @type {Way} */ way) {
  const w = set.window;
  if (!w || w.gone) return undefined;
  if (way === "next") {
    const from = w.first + set.rows.length;
    return w.done && from >= w.known ? undefined : { from, count: w.page };
  }
  if (w.first === 0) return undefined;
  const from = Math.max(0, w.first - w.page);
  return { from, count: w.first - from };
}

/** About how many bytes a row's values take in the frame (two a character). */
const sizeOf = (/** @type {(string | null)[]} */ row) =>
  row.reduce((sum, value) => sum + (value === null ? 8 : 2 * value.length + 16), 16);

/**
 * The set with a fetched page placed at its end `way`, and the pages far from it let go.
 * @param {ResultSet} set @param {Way} way @param {Fetched} got @returns {ResultSet}
 */
export function placed(set, way, got) {
  const w = /** @type {Window} */ (set.window);
  let rows = way === "next" ? [...set.rows, ...got.rows] : [...got.rows, ...set.rows];
  let first = way === "next" ? w.first : w.first - got.rows.length;
  const known = got.total ?? Math.max(w.known, first + rows.length);
  const done = w.done || (way === "next" && got.done);
  let bytes = rows.reduce((sum, row) => sum + sizeOf(row), 0);
  // Let go of whole pages at the far end, keeping the page just placed and the one before it.
  const most = Math.max(HOLD_PAGES * w.page, HOLD_ROWS);
  while (rows.length > 2 * w.page && (rows.length > most || bytes > HOLD_BYTES)) {
    const going = way === "next" ? rows.slice(0, w.page) : rows.slice(-w.page);
    bytes -= going.reduce((sum, row) => sum + sizeOf(row), 0);
    rows = way === "next" ? rows.slice(w.page) : rows.slice(0, rows.length - w.page);
    if (way === "next") first += w.page;
  }
  const next = { ...set, rows, window: { ...w, first, known, done } };
  return { ...next, truncated: !whole(next) };
}

/** The set counted to its end: the total known, the rows held as they are. */
export const counted = (/** @type {ResultSet} */ set, /** @type {number} */ total) => {
  const w = /** @type {Window} */ (set.window);
  const next = { ...set, window: { ...w, known: total, done: true } };
  return { ...next, truncated: !whole(next) };
};

/** The set whose cursor is gone (`why`): the rows held stay, the rest cannot be read. */
export const lost = (/** @type {ResultSet} */ set, /** @type {string} */ why) => ({
  ...set,
  window: { .../** @type {Window} */ (set.window), gone: why },
});

/** What the strip says of a set its cursor keeps: the rows on screen of how many. */
export function rowsLine(/** @type {ResultSet} */ set, /** @type {(n: number) => string} */ count) {
  const w = set.window;
  if (!w) return "";
  const from = set.rows.length ? w.first + 1 : 0;
  const of = w.done ? count(w.known) : `at least ${count(w.known)}`;
  const gone = w.gone ? ` (${w.gone})` : "";
  return `Rows ${count(from)}–${count(w.first + set.rows.length)} of ${of}${gone}`;
}
