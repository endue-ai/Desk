// The lane of a scroll position: which screen columns the grid draws and the rows' column template.
// The pinned columns first, then a gap as wide as the columns scrolled past, then the ones in view,
// then a track as wide as the rest, so a row is as wide as all its columns while only a few are in
// the page (view-grid-draw.js makes the elements). The record view has two columns, Column and the
// value. No DOM.

import { CELL_PAD, inView } from "./columns.js";

/**
 * @typedef {import("./columns.js").Layout} Layout
 * @typedef {import("../view-grid-draw.js").Lane} Lane
 */

const range = (/** @type {number} */ from, /** @type {number} */ to) =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/**
 * @param {Layout} layout
 * @param {number} scrollLeft
 * @param {number} width The scroller's width.
 * @returns {Lane}
 */
export function laneOf(layout, scrollLeft, width) {
  const { from, to } = inView(layout, scrollLeft, width);
  const n = layout.visible.length;
  const px = (/** @type {number} */ i) => `${layout.widths[i] ?? 0}px`;
  const start = from < n ? (layout.offsets[from] ?? 0) : layout.total;
  const end = to > from ? (layout.offsets[to - 1] ?? 0) + (layout.widths[to - 1] ?? 0) : start;
  const template = [
    ...range(0, layout.pinned).map(px),
    `${start - layout.pinnedWidth}px`,
    ...range(from, to).map(px),
    `${layout.total - end}px`,
  ];
  return {
    cols: [...range(0, layout.pinned), ...range(from, to)],
    pinned: layout.pinned,
    lefts: layout.offsets.slice(0, layout.pinned),
    template: template.join(" "),
  };
}

/**
 * The record view's lane: the column names as wide as the longest, the values 60 characters.
 * @param {string[]} names
 * @param {number} ch A character's width.
 * @returns {Lane}
 */
export function recordLane(names, ch) {
  const name = Math.ceil(Math.max(8, ...names.map((n) => n.length + 2)) * ch) + CELL_PAD;
  const value = Math.ceil(60 * ch) + CELL_PAD;
  return { cols: [0, 1], pinned: 0, lefts: [], template: `0px ${name}px ${value}px 0px` };
}

export { range };
