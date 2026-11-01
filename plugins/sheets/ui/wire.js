// Cell payloads cross the worker boundary as owned buffers. The UI decodes only requested cells;
// installing a million-row sheet never clones or rebuilds a million JavaScript cell objects.
import { cellWriter, readCell } from "./cells.js";
import { axis, axisFrom } from "./layout.js";
import { createSheet } from "./model.js";

/** @typedef {import("./model.js").Sheet} Sheet */

/** @param {Sheet} sheet @param {(done: number, total: number) => void} [progress] */
export function packSheet(sheet, progress) {
  const writer = cellWriter();
  let ids = new Uint32Array(4096);
  let columns = new Uint32Array(4096);
  let offsets = new Uint32Array(4097);
  let count = 0;
  const rows = new Uint32Array(sheet.rows + 1);
  for (let r = 0; r < sheet.rows; r++) {
    rows[r] = count;
    for (let c = 0; c < sheet.cols; c++) {
      const cell = sheet.cell(r, c);
      const style = sheet.style(r, c);
      if (!cell && !style) continue;
      if (count === columns.length) {
        const cols = new Uint32Array(columns.length * 2);
        const meta = new Uint32Array(cols.length);
        meta.set(ids);
        ids = meta;
        const starts = new Uint32Array(cols.length + 1);
        cols.set(columns);
        starts.set(offsets);
        columns = cols;
        offsets = starts;
      }
      columns[count] = c;
      offsets[count] = writer.length;
      ids[count++] = writer.write(cell, style, cell?.w ?? sheet.text(r, c));
    }
    // The worker no longer needs a row after its cells have been encoded.
    sheet.releaseRow?.(r);
    if (r % 2048 === 0) progress?.(r, sheet.rows);
  }
  rows[sheet.rows] = count;
  offsets[count] = writer.length;
  const sizes = (length, size, hidden) => {
    const values = new Float32Array(length);
    const flags = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      values[i] = size(i);
      flags[i] = Number(hidden(i));
    }
    const { index, offset } = axis(length, size, hidden);
    return { values, flags, index, offset };
  };
  return {
    name: sheet.name,
    rows: sheet.rows,
    cols: sheet.cols,
    lastRow: sheet.lastRow,
    lastCol: sheet.lastCol,
    merges: sheet.merges,
    frozen: sheet.frozen,
    rowStarts: rows,
    columns: columns.subarray(0, count),
    offsets: offsets.subarray(0, count + 1),
    ids: ids.subarray(0, count),
    ...writer.finish(),
    rowSizes: sizes(sheet.rows, sheet.height, sheet.hiddenRow),
    colSizes: sizes(sheet.cols, sheet.width, sheet.hiddenCol),
  };
}

/** @typedef {ReturnType<typeof packSheet>} PackedSheet */
/** @param {PackedSheet} packed */
export function transfers(packed) {
  return [
    packed.rowStarts,
    packed.columns,
    packed.offsets,
    packed.data,
    packed.ids,
    ...Object.values(packed.rowSizes),
    ...Object.values(packed.colSizes),
  ].map((value) => value.buffer);
}

/** @param {PackedSheet} packed @returns {Sheet} */
export function unpackSheet(packed) {
  const cache = new Map();
  const formats = new WeakMap();
  const entry = (r, c) => {
    if (r < 0 || r >= packed.rows) return undefined;
    let lo = packed.rowStarts[r];
    let hi = packed.rowStarts[r + 1];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (packed.columns[mid] < c) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= packed.rowStarts[r + 1] || packed.columns[lo] !== c) return undefined;
    let value = cache.get(lo);
    if (!value) {
      value = readCell(packed.data, packed.offsets[lo], packed.metadata[packed.ids[lo]]);
      if (cache.size >= 2048) cache.delete(cache.keys().next().value);
      cache.set(lo, value);
      if (value[0] && value[2] !== undefined) formats.set(value[0], value[2]);
    }
    return value;
  };
  const sheet = createSheet({
    ...packed,
    cellAt: (r, c) => entry(r, c)?.[0] ?? undefined,
    format: (cell) => formats.get(cell),
  });
  return Object.assign(sheet, {
    style: (r, c) => entry(r, c)?.[1] ?? undefined,
    width: (c) => packed.colSizes.values[c] ?? 64,
    height: (r) => packed.rowSizes.values[r] ?? 20,
    hiddenRow: (r) => Boolean(packed.rowSizes.flags[r]),
    hiddenCol: (c) => Boolean(packed.colSizes.flags[c]),
    axes: {
      rows: axisFrom(packed.rowSizes.index, packed.rowSizes.offset),
      cols: axisFrom(packed.colSizes.index, packed.colSizes.offset),
    },
  });
}
