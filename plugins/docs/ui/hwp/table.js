// Tables ("tbl " controls): the caption's list before the TABLE record, then one LIST_HEADER per
// cell with its address, spans, size and border fill. Column widths come from the cells that span
// one column, then from the spanning cells once the others are known.
import { Reader } from "../bytes.js";
import { pt } from "../model.js";
import { listAfter, TAG } from "./records.js";

/**
 * @typedef {import("./records.js").Rec} Rec
 * @typedef {import("../model.js").Block} Block
 * @typedef {import("../model.js").Cell} Cell
 * @typedef {{ col: number, row: number, cols: number, width: number }} Box
 */

/**
 * The table and its caption, the caption above or below it as Hangul places it.
 * @param {Rec} ctrl
 * @param {import("./paragraph.js").Ctx} ctx
 * @param {import("./paragraph.js").Sink} sink
 * @returns {Block[]}
 */
export function tableBlocks(ctrl, ctx, sink) {
  const kids = ctrl.kids;
  const at = kids.findIndex((k) => k.tag === TAG.TABLE);
  if (at < 0) return [];
  const tr = new Reader(kids[at]?.data ?? new Uint8Array(0));
  // A caption's list comes before the TABLE record; bits 0-1 of its properties place it.
  const caption = kids.slice(0, at).find((k) => k.tag === TAG.LIST_HEADER);
  const captionBlocks = sink.list(kids.slice(0, at));
  const above = caption ? (new Reader(caption.data).u32(8) & 3) === 2 : false;
  const fills = ctx.info.fills;
  // The table's own border fill follows its row sizes: 18 bytes, then a WORD per row.
  let borders = fills[tr.u16(18 + 2 * tr.u16(4)) - 1]?.border ?? false;
  /** @type {Map<number, Array<Cell & { col: number }>>} */
  const rows = new Map();
  /** @type {Box[]} */
  const boxes = [];
  kids.forEach((kid, i) => {
    if (i <= at || kid.tag !== TAG.LIST_HEADER) return;
    const r = new Reader(kid.data);
    const [col, row] = [r.u16(8), r.u16(10)];
    const width = pt(r.u32(16) / 100);
    const fill = fills[r.u16(32) - 1];
    if (fill?.border) borders = true;
    /** @type {Cell & { col: number }} */
    const cell = {
      col,
      blocks: sink.list([kid, ...listAfter(kids, i)]),
      colSpan: Math.max(1, r.u16(12)),
      rowSpan: Math.max(1, r.u16(14)),
    };
    if (width) cell.width = width;
    if (fill?.fill) cell.fill = fill.fill;
    const cells = rows.get(row) ?? [];
    rows.set(row, cells);
    cells.push(cell);
    boxes.push({ col, row, cols: cell.colSpan, width });
  });
  const height = Math.max(0, ...[...rows].flatMap(([r, cells]) => cells.map((c) => r + c.rowSpan)));
  /** @type {import("../model.js").Table} */
  const table = {
    type: "table",
    borders,
    // Every row, even one whose cells all belong to merges from above, keeps its place.
    rows: Array.from({ length: height }, (_, r) => ({
      cells: (rows.get(r) ?? []).sort((a, b) => a.col - b.col).map(({ col: _, ...cell }) => cell),
    })),
  };
  const columns = columnWidths(boxes, tr.u16(6));
  if (columns) table.columns = columns;
  return above ? [...captionBlocks, table] : [table, ...captionBlocks];
}

/**
 * Each column's width in points, or undefined when the cells leave one unknown.
 * @param {Box[]} boxes
 * @param {number} count the TABLE record's column count
 */
export function columnWidths(boxes, count) {
  const cols = Math.max(count, ...boxes.map((b) => b.col + b.cols));
  if (cols === 0 || cols > 512) return undefined;
  /** @type {Array<number | undefined>} */
  const widths = Array(cols).fill(undefined);
  for (const b of boxes)
    if (b.cols === 1 && b.width && widths[b.col] === undefined) widths[b.col] = b.width;
  // A spanning cell whose columns all but one are known gives that one.
  for (let pass = 0; pass < 4 && widths.includes(undefined); pass++)
    for (const b of boxes) {
      const span = widths.slice(b.col, b.col + b.cols);
      const unknown = span.filter((w) => w === undefined).length;
      if (unknown !== 1 || !b.width) continue;
      const known = span.reduce((sum, w) => (sum ?? 0) + (w ?? 0), 0) ?? 0;
      const left = pt(b.width - known);
      if (left > 0) widths[b.col + span.indexOf(undefined)] = left;
    }
  if (widths.some((w) => w === undefined)) return undefined;
  return /** @type {number[]} */ (widths);
}
