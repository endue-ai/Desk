// The grid's columns without the DOM: which of a result's columns show, in what order, which are
// pinned to the left and how wide each is. The state names columns by key (a column's name, a
// repeated one as `name#2`), so it holds when a new run brings the columns in another order, and a
// table view keeps it in the store (`keepColumns`, `readColumns`; ADR 0288). Every operation returns
// a new state. Pinned keys lead `order`, so the screen order is `order` without the hidden ones.
// Imports nothing.

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {{ order: string[], hidden: string[], pinned: string[], widths: Record<string, number> }} ColumnState
 *   `order` is empty until a column moves; `widths` holds only the widths the person set.
 * @typedef {{
 *   keys: string[], visible: number[], pinned: number, widths: number[], offsets: number[],
 *   total: number, pinnedWidth: number,
 * }} Layout
 *   `visible`: the result's columns in screen order, the `pinned` first; `widths` and `offsets` (each
 *   one's left edge in the row) by screen column.
 */

export const MIN_WIDTH = 40;
export const MAX_WIDTH = 1200;
/** Padding and border of a cell, beside its characters. */
export const CELL_PAD = 17;
/** Characters a header holds past its name: a sort key's arrow and number. */
export const NAME_ROOM = 3;
const FIT_CHARS = 100;

/** @returns {ColumnState} */
export const emptyColumns = () => ({ order: [], hidden: [], pinned: [], widths: {} });

/** Each column's key: its name, a repeated name with its count (`id`, `id#2`). */
export function columnKeys(/** @type {string[]} */ names) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}#${count}`;
  });
}

const clamp = (/** @type {number} */ px) =>
  Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, px)));

/** Every key of the result in the state's order, pinned first, new ones at the end. */
function fullOrder(/** @type {ColumnState} */ state, /** @type {string[]} */ keys) {
  const present = new Set(keys);
  const known = state.order.filter((key) => present.has(key));
  const placed = new Set(known);
  const all = [...known, ...keys.filter((key) => !placed.has(key))];
  const pinned = new Set(state.pinned);
  return [...all.filter((key) => pinned.has(key)), ...all.filter((key) => !pinned.has(key))];
}

/**
 * Where each column is drawn, in pixels from `defaults` (by result column) and the state's widths.
 * @param {string[]} names
 * @param {ColumnState} state
 * @param {number[]} defaults
 * @returns {Layout}
 */
export function layoutOf(names, state, defaults) {
  const keys = columnKeys(names);
  const index = new Map(keys.map((key, i) => [key, i]));
  const hidden = new Set(state.hidden);
  const pinnedKeys = new Set(state.pinned);
  const shown = fullOrder(state, keys).filter((key) => !hidden.has(key));
  const visible = shown.map((key) => /** @type {number} */ (index.get(key)));
  const pinned = shown.filter((key) => pinnedKeys.has(key)).length;
  const px = visible.map((c, i) => state.widths[shown[i] ?? ""] ?? defaults[c] ?? 100);
  const offsets = [];
  let total = 0;
  for (const width of px) {
    offsets.push(total);
    total += width;
  }
  const pinnedWidth = px.slice(0, pinned).reduce((sum, w) => sum + w, 0);
  return { keys, visible, pinned, widths: px, offsets, total, pinnedWidth };
}

/** @returns {ColumnState} */
export function hide(/** @type {ColumnState} */ state, /** @type {string} */ key) {
  return state.hidden.includes(key) ? state : { ...state, hidden: [...state.hidden, key] };
}

/** @returns {ColumnState} */
export function show(/** @type {ColumnState} */ state, /** @type {string} */ key) {
  return { ...state, hidden: state.hidden.filter((k) => k !== key) };
}

/** A column's width, kept between MIN_WIDTH and MAX_WIDTH. @returns {ColumnState} */
export function resize(
  /** @type {ColumnState} */ state,
  /** @type {string} */ key,
  /** @type {number} */ px,
) {
  return { ...state, widths: { ...state.widths, [key]: clamp(px) } };
}

/**
 * Move a column to a screen position inside its block (pinned or not), from before or after it.
 * @param {ColumnState} state
 * @param {string[]} keys The result's column keys.
 * @param {string} key
 * @param {number} index The screen position it should take.
 * @returns {ColumnState}
 */
export function moveTo(state, keys, key, index) {
  const order = fullOrder(state, keys);
  const hidden = new Set(state.hidden);
  const screen = order.filter((k) => !hidden.has(k));
  const at = screen.indexOf(key);
  if (at < 0) return state;
  const pinned = screen.filter((k) => state.pinned.includes(k)).length;
  const [low, high] = at < pinned ? [0, pinned - 1] : [pinned, screen.length - 1];
  const target = Math.max(low, Math.min(high, index));
  if (target === at) return state;
  const neighbour = /** @type {string} */ (screen[target]);
  const rest = order.filter((k) => k !== key);
  rest.splice(rest.indexOf(neighbour) + (target > at ? 1 : 0), 0, key);
  return { ...state, order: rest };
}

/** Move a column `delta` places on screen; past the end of its block it stays. */
export function move(
  /** @type {ColumnState} */ state,
  /** @type {string[]} */ keys,
  /** @type {string} */ key,
  /** @type {number} */ delta,
) {
  const hidden = new Set(state.hidden);
  const screen = fullOrder(state, keys).filter((k) => !hidden.has(k));
  const at = screen.indexOf(key);
  const pinned = screen.filter((k) => state.pinned.includes(k)).length;
  const target = at + delta;
  const inside = at < pinned ? target >= 0 && target < pinned : target >= pinned;
  return at < 0 || !inside || target >= screen.length ? state : moveTo(state, keys, key, target);
}

/** Pin a column at the end of the pinned block, or unpin it to just after the block. */
export function pin(
  /** @type {ColumnState} */ state,
  /** @type {string[]} */ keys,
  /** @type {string} */ key,
) {
  const order = fullOrder(state, keys).filter((k) => k !== key);
  const pinned = state.pinned.includes(key)
    ? state.pinned.filter((k) => k !== key)
    : [...state.pinned, key];
  const lead = order.filter((k) => pinned.includes(k)).length;
  order.splice(lead, 0, key);
  return { ...state, order, pinned };
}

/**
 * The screen columns to draw for a scroll position: the unpinned ones in view (and `overscan` more
 * each side) as [from, to); the pinned ones are always drawn.
 * @param {Layout} layout
 * @param {number} scrollLeft
 * @param {number} width The scroller's width.
 */
export function inView(layout, scrollLeft, width, overscan = 2) {
  const n = layout.visible.length;
  const start = scrollLeft + layout.pinnedWidth;
  const end = scrollLeft + width;
  let from = layout.pinned;
  while (from < n && (layout.offsets[from] ?? 0) + (layout.widths[from] ?? 0) <= start) from++;
  let to = from;
  while (to < n && (layout.offsets[to] ?? 0) < end) to++;
  return {
    from: Math.max(layout.pinned, from - overscan),
    to: Math.min(n, Math.max(to, from + 1) + overscan),
  };
}

/** A column fitted to its longest text (cut at 100 characters) and its name, in pixels. */
export function fitWidth(
  /** @type {ResultSet} */ set,
  /** @type {number} */ col,
  /** @type {number} */ ch,
) {
  let chars = Math.min(FIT_CHARS, (set.columns[col] ?? "").length + NAME_ROOM);
  for (let r = 0; r < set.rows.length && chars < FIT_CHARS; r++) {
    const value = set.rows[r]?.[col] ?? null;
    chars = Math.max(chars, Math.min(FIT_CHARS, (value === null ? 4 : value.length) + 1));
  }
  return clamp(Math.ceil(chars * ch) + CELL_PAD);
}

/** What a table view keeps in the store. */
export const keepColumns = (/** @type {ColumnState} */ state) => ({ v: 1, ...state });

/** A kept state, or the default one when it is of another version or shape. @returns {ColumnState} */
export function readColumns(/** @type {unknown} */ kept) {
  const value = /** @type {Record<string, unknown> | null} */ (
    kept && typeof kept === "object" ? kept : null
  );
  const names = (/** @type {unknown} */ list) =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  const sizes = value?.widths;
  if (
    value?.v !== 1 ||
    !names(value.order) ||
    !names(value.hidden) ||
    !names(value.pinned) ||
    !sizes ||
    typeof sizes !== "object" ||
    Array.isArray(sizes)
  )
    return emptyColumns();
  /** @type {Record<string, number>} */
  const px = {};
  for (const [key, width] of Object.entries(sizes))
    if (typeof width === "number" && Number.isFinite(width)) px[key] = clamp(width);
  return {
    order: /** @type {string[]} */ (value.order),
    hidden: /** @type {string[]} */ (value.hidden),
    pinned: /** @type {string[]} */ (value.pinned),
    widths: px,
  };
}
