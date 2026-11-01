// Tables ([MS-DOC] 2.4.3, 2.6.3): each row's properties sit on its row mark (TTP). The cell edges of
// every row (sprmTDefTable) make one grid; a cell spans the grid columns between its edges,
// horizontal merges join cells, vertical merges become a row span on the first cell. Shading and
// borders come from the row's sprms and its table style.
import { pt, twips } from "../model.js";
import { shd, shd80 } from "./props.js";
import { eachSprm } from "./sprm.js";

/**
 * @typedef {{ horz: number, vert: number, fill?: string, border: boolean }} TapCell
 * @typedef {{ edges: number[], cells: TapCell[], borders: boolean, header: boolean, istd: number }} Tap
 * @typedef {{ tap: Tap, cells: import("../model.js").Block[][] }} RowIn
 */

/** A Brc80MayBeNil (4 bytes) or Brc (8 bytes) that draws a line. */
const brc80 = (/** @type {import("../bytes.js").Reader} */ r, /** @type {number} */ at) =>
  r.u32(at) !== 0xffffffff && ![0, 0xff].includes(r.u8(at + 1));
const brc = (/** @type {import("../bytes.js").Reader} */ r, /** @type {number} */ at) =>
  r.u32(at + 4) !== 0xffffffff && ![0, 0xff].includes(r.u8(at + 5));

/** @returns {Tap} */
export const emptyTap = () => ({ edges: [], cells: [], borders: false, header: false, istd: -1 });

/**
 * Apply the table sprms of a grpprl to `tap`.
 * @param {Tap} tap
 * @param {Uint8Array | null} grpprl
 */
export function applyTap(tap, grpprl) {
  if (!grpprl?.length) return;
  const cell = (/** @type {number} */ i) => {
    while (tap.cells.length <= i) tap.cells.push({ horz: 0, vert: 0, border: false });
    return /** @type {TapCell} */ (tap.cells[i]);
  };
  eachSprm(grpprl, (sprm, r, at, size) => {
    switch (sprm) {
      case 0xd608:
      case 0xd606: {
        const count = Math.min(63, r.u8(at + 2));
        tap.edges = Array.from({ length: count + 1 }, (_, i) => r.i16(at + 3 + i * 2));
        const tcs = at + 3 + (count + 1) * 2;
        const room = Math.floor((at + size - tcs) / 20);
        tap.cells = [];
        for (let i = 0; i < count; i++) {
          const c = cell(i);
          if (i >= room) continue;
          const tc = tcs + i * 20;
          const grf = r.u16(tc);
          c.horz = grf & 3;
          c.vert = (grf >> 5) & 3;
          c.border = [4, 8, 12, 16].some((o) => brc80(r, tc + o));
        }
        break;
      }
      case 0xd609:
        for (let i = 0; i * 2 < r.u8(at); i++) cell(i).fill = shd80(r.u16(at + 1 + i * 2));
        break;
      case 0xd612:
      case 0xd616:
      case 0xd60c:
      case 0xd670:
      case 0xd671:
      case 0xd672: {
        const first = [0xd616, 0xd671].includes(sprm)
          ? 22
          : [0xd60c, 0xd672].includes(sprm)
            ? 44
            : 0;
        for (let i = 0; i * 10 < r.u8(at); i++) cell(first + i).fill = shd(r, at + 1 + i * 10);
        break;
      }
      case 0xd62d:
        for (let i = r.u8(at + 1); i < r.u8(at + 2); i++) cell(i).fill = shd(r, at + 3);
        break;
      case 0xd605:
        if ([0, 4, 8, 12, 16, 20].some((o) => brc80(r, at + 1 + o))) tap.borders = true;
        break;
      case 0xd613:
        if ([0, 8, 16, 24, 32, 40].some((o) => brc(r, at + 1 + o))) tap.borders = true;
        break;
      case 0xd620:
        if (brc80(r, at + 4))
          for (let i = r.u8(at + 1); i < r.u8(at + 2); i++) cell(i).border = true;
        break;
      case 0xd62f:
        if (brc(r, at + 4)) for (let i = r.u8(at + 1); i < r.u8(at + 2); i++) cell(i).border = true;
        break;
      case 0x3404:
        tap.header = r.u8(at) !== 0;
        break;
      case 0xd62b:
        cell(r.u8(at + 1)).vert = r.u8(at + 2) & 3;
        break;
      case 0x5624:
        for (let i = r.u8(at); i < r.u8(at + 1); i++) cell(i).horz = i === r.u8(at) ? 1 : 2;
        break;
      case 0x5625:
        for (let i = r.u8(at); i < r.u8(at + 1); i++) cell(i).horz = 0;
        break;
      case 0x563a:
        tap.istd = r.u16(at);
        break;
      case 0x7621:
        // sprmTInsert defines cells only for a row without sprmTDefTable.
        if (tap.edges.length === 0) {
          const width = r.i16(at + 2);
          tap.edges = [0];
          for (let i = 0; i < r.u8(at + 1); i++) tap.edges.push((i + 1) * width);
        }
        break;
    }
    return false;
  });
}

/**
 * The model of a table from its rows: the grid of every row's edges, spans, merges and fills.
 * @param {RowIn[]} rows
 * @param {boolean} styleBorders whether the table style draws borders
 * @returns {import("../model.js").Table}
 */
export function buildTable(rows, styleBorders) {
  const edges = [...new Set(rows.flatMap((row) => edgesOf(row)))].sort((a, b) => a - b);
  const column = (/** @type {number} */ x) => {
    let best = 0;
    for (let i = 0; i < edges.length; i++)
      if (Math.abs((edges[i] ?? 0) - x) < Math.abs((edges[best] ?? 0) - x)) best = i;
    return best;
  };
  /** The cell a vertical merge started in, by grid column. */
  /** @type {Map<number, import("../model.js").Cell>} */
  const open = new Map();
  let borders = styleBorders;
  /** @type {import("../model.js").Row[]} */
  const out = [];
  for (const row of rows) {
    const rowEdges = edgesOf(row);
    /** @type {import("../model.js").Row} */
    const model = { cells: [] };
    if (row.tap.header) model.header = true;
    if (row.tap.borders) borders = true;
    /** @type {import("../model.js").Cell | undefined} */
    let last;
    row.cells.forEach((blocks, i) => {
      const tc = row.tap.cells[i] ?? { horz: 0, vert: 0, border: false };
      if (tc.border) borders = true;
      const from = column(rowEdges[i] ?? 0);
      const to = Math.max(from + 1, column(rowEdges[i + 1] ?? 0));
      const span = to - from;
      const width = twips((rowEdges[i + 1] ?? 0) - (rowEdges[i] ?? 0));
      // horzMerge as Word writes it: 1 starts a merged set, 2 joins the cell before.
      if (tc.horz & 2 && last) {
        last.colSpan += span;
        last.width = pt((last.width ?? 0) + Math.max(0, width));
        return;
      }
      if (tc.vert === 1) {
        const origin = open.get(from);
        if (origin) {
          origin.rowSpan++;
          last = undefined;
          return;
        }
      }
      /** @type {import("../model.js").Cell} */
      const cell = { blocks, colSpan: span, rowSpan: 1 };
      if (width > 0) cell.width = width;
      if (tc.fill) cell.fill = tc.fill;
      if (tc.vert === 3) open.set(from, cell);
      else for (let c = from; c < to; c++) open.delete(c);
      model.cells.push(cell);
      last = cell;
    });
    if (model.cells.length > 0 || row.cells.length > 0) out.push(model);
  }
  /** @type {import("../model.js").Table} */
  const table = { type: "table", rows: out, borders };
  const columns = edges.slice(1).map((x, i) => twips(x - (edges[i] ?? 0)));
  if (columns.length > 0 && columns.every((c) => c > 0)) table.columns = columns;
  return table;
}

/** A row's cell edges: its own, or evenly spaced when the file gave none. */
function edgesOf(/** @type {RowIn} */ row) {
  const { edges } = row.tap;
  if (edges.length >= row.cells.length + 1) return edges;
  return Array.from({ length: row.cells.length + 1 }, (_, i) => i * 1440);
}
