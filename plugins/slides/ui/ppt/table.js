// Tables of PowerPoint 2000 and later ([MS-PPT] 2.11, a group whose tableProperties are set): its
// cells are text shapes and its borders line shapes. The grid comes from the cells' edges, spans
// from cells that cross grid lines, borders from the lines along a cell's sides. No DOM.
import { textOf } from "../deck.js";
import { childrenOf } from "./records.js";

/**
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Cell} Cell
 * @typedef {import("../deck.js").Line} Line
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {import("./shapes.js").Frame} Frame
 * @typedef {import("./shapes.js").Scope} Scope
 * @typedef {(sp: PptRecord, frame: Frame, scope: Scope) => SlideElement | null} ReadShape
 */

const NEAR = 0.75;

/** Sorted distinct values, those within NEAR of one another counted once. @param {number[]} values */
function edges(values) {
  /** @type {number[]} */
  const out = [];
  for (const v of [...values].sort((a, b) => a - b))
    if (out.length === 0 || v - (out.at(-1) ?? 0) > NEAR) out.push(v);
  return out;
}

/** The index of the edge nearest `v`. @param {number[]} list @param {number} v */
const indexOf = (list, v) => {
  let best = 0;
  for (const [i, e] of list.entries())
    if (Math.abs(e - v) < Math.abs((list[best] ?? 0) - v)) best = i;
  return best;
};

/**
 * A table group as a table, or null when its shapes do not make a grid.
 * @param {PptRecord} spgr @param {Box} box @param {Frame} frame @param {Scope} scope @param {ReadShape} read
 * @returns {SlideElement | null}
 */
export function readTable(spgr, box, frame, scope, read) {
  /** @type {Array<Extract<SlideElement, { type: "shape" }>>} */
  const cells = [];
  /** @type {Array<Extract<SlideElement, { type: "shape" }>>} */
  const lines = [];
  for (const [i, rec] of childrenOf(scope.doc, spgr).entries()) {
    if (i === 0) continue;
    const element = read(rec, frame, scope);
    if (element?.type !== "shape") continue;
    if (element.geometry.name === "line") lines.push(element);
    else cells.push(element);
  }
  if (cells.length === 0) return null;
  const xs = edges(cells.flatMap((c) => [c.box.x, c.box.x + c.box.w]));
  const ys = edges(cells.flatMap((c) => [c.box.y, c.box.y + c.box.h]));
  if (xs.length < 2 || ys.length < 2) return null;
  /** @type {Array<Array<Cell | undefined>>} */
  const grid = ys.slice(1).map(() => xs.slice(1).map(() => undefined));
  /** @type {Array<{ cell: Cell, l: number, t: number, r: number, b: number }>} */
  const placed = [];
  for (const shape of cells) {
    const [c0, c1] = [indexOf(xs, shape.box.x), indexOf(xs, shape.box.x + shape.box.w)];
    const [r0, r1] = [indexOf(ys, shape.box.y), indexOf(ys, shape.box.y + shape.box.h)];
    if (c1 <= c0 || r1 <= r0 || grid[r0]?.[c0]) continue;
    /** @type {Cell} */
    const cell = {
      text: shape.text ?? textOf([]),
      fill: shape.fill,
      borders: { left: null, top: null, right: null, bottom: null },
      colSpan: c1 - c0,
      rowSpan: r1 - r0,
      merged: false,
    };
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        const row = grid[r];
        if (row)
          row[c] = r === r0 && c === c0 ? cell : { ...cell, merged: true, colSpan: 1, rowSpan: 1 };
      }
    placed.push({
      cell,
      l: shape.box.x,
      t: shape.box.y,
      r: shape.box.x + shape.box.w,
      b: shape.box.y + shape.box.h,
    });
  }
  for (const line of lines) {
    if (!line.line) continue;
    const { x, y, w, h } = line.box;
    const flat = Math.abs(h) <= NEAR;
    const upright = Math.abs(w) <= NEAR;
    for (const p of placed) {
      if (flat && x <= (p.l + p.r) / 2 && x + w >= (p.l + p.r) / 2) {
        if (Math.abs(p.t - y) <= NEAR) p.cell.borders.top = line.line;
        if (Math.abs(p.b - y) <= NEAR) p.cell.borders.bottom = line.line;
      }
      if (upright && y <= (p.t + p.b) / 2 && y + h >= (p.t + p.b) / 2) {
        if (Math.abs(p.l - x) <= NEAR) p.cell.borders.left = line.line;
        if (Math.abs(p.r - x) <= NEAR) p.cell.borders.right = line.line;
      }
    }
  }
  const empty = () =>
    /** @type {Cell} */ ({
      text: textOf([]),
      fill: { type: "none" },
      borders: { left: null, top: null, right: null, bottom: null },
      colSpan: 1,
      rowSpan: 1,
      merged: false,
    });
  return /** @type {SlideElement} */ ({
    type: "table",
    name: "Table",
    box,
    columns: xs.slice(1).map((v, i) => v - (xs[i] ?? 0)),
    rows: grid.map((row, i) => ({
      height: (ys[i + 1] ?? 0) - (ys[i] ?? 0),
      cells: row.map((cell) => cell ?? empty()),
    })),
  });
}
