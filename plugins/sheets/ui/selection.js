// The selection on one sheet, as spreadsheet programs keep it: an active cell, which the formula
// bar shows, and the far end of a range, which Shift moves. Moves step over hidden rows and columns
// and treat a merged area as one cell; Mod+arrows go to the edge of the data. No DOM.

/**
 * @typedef {import("./model.js").Sheet} Sheet
 * @typedef {import("./model.js").Range} Range
 * @typedef {import("./model.js").Address} Address
 * @typedef {import("./layout.js").Axis} Axis
 */

/** At most this many cells are counted for the status line; a larger range counts its start. */
const STATS_LIMIT = 5_000_000;

/**
 * @param {Sheet} sheet
 * @param {Axis} rows
 * @param {Axis} cols
 */
export function createSelection(sheet, rows, cols) {
  /** Merges by each row they cover, so finding one is a lookup. @type {Map<number, Range[]>} */
  const byRow = new Map();
  for (const merge of sheet.merges) {
    for (let r = merge.s.r; r <= merge.e.r && r - merge.s.r < 10_000; r++) {
      const list = byRow.get(r);
      if (list) list.push(merge);
      else byRow.set(r, [merge]);
    }
  }
  const mergeAt = (/** @type {number} */ r, /** @type {number} */ c) =>
    byRow.get(r)?.find((m) => c >= m.s.c && c <= m.e.c);

  const first = { r: rows.index[0] ?? 0, c: cols.index[0] ?? 0 };
  let active = { ...first };
  let end = { ...first };

  /** The visible row or column `step` positions from i on an axis, clamped to its ends. */
  const step = (/** @type {Axis} */ axis, /** @type {number} */ i, /** @type {number} */ by) => {
    const p = axis.position(i) < 0 ? axis.from(i) : axis.position(i);
    const next = Math.min(axis.count - 1, Math.max(0, p + by));
    return axis.index[next] ?? i;
  };

  /** The top-left of the merged area a cell is in, or the cell. */
  const snap = (/** @type {Address} */ at) => {
    const merge = mergeAt(at.r, at.c);
    return merge ? { ...merge.s } : at;
  };

  /** One step from a cell, leaving a merged area from its far side. */
  const moved = (/** @type {Address} */ at, /** @type {number} */ dr, /** @type {number} */ dc) => {
    const merge = mergeAt(at.r, at.c);
    const r = merge ? (dr > 0 ? merge.e.r : dr < 0 ? merge.s.r : at.r) : at.r;
    const c = merge ? (dc > 0 ? merge.e.c : dc < 0 ? merge.s.c : at.c) : at.c;
    return { r: dr ? step(rows, r, dr) : at.r, c: dc ? step(cols, c, dc) : at.c };
  };

  /** Mod+arrow: to the last filled cell of a block, or the first filled one past a gap. */
  const edge = (/** @type {Address} */ at, /** @type {number} */ dr, /** @type {number} */ dc) => {
    const axis = dr ? rows : cols;
    const along = (/** @type {number} */ p) => axis.index[p] ?? 0;
    const filled = (/** @type {number} */ p) =>
      dr ? sheet.filled(along(p), at.c) : sheet.filled(at.r, along(p));
    const by = dr || dc;
    const last = by > 0 ? axis.count - 1 : 0;
    let p = axis.position(dr ? at.r : at.c);
    if (p < 0 || p === last) return at;
    if (filled(p) && filled(p + by)) {
      while (p !== last && filled(p + by)) p += by;
    } else {
      p += by;
      while (p !== last && !filled(p)) p += by;
    }
    return dr ? { r: along(p), c: at.c } : { r: at.r, c: along(p) };
  };

  /** The range between the active cell and the far end, grown to cover the merges it cuts. */
  const range = () => {
    const box = {
      s: { r: Math.min(active.r, end.r), c: Math.min(active.c, end.c) },
      e: { r: Math.max(active.r, end.r), c: Math.max(active.c, end.c) },
    };
    for (let grew = true, rounds = 0; grew && rounds < 8; rounds++) {
      grew = false;
      for (const m of sheet.merges) {
        const cuts = m.s.r <= box.e.r && m.e.r >= box.s.r && m.s.c <= box.e.c && m.e.c >= box.s.c;
        if (!cuts) continue;
        const before = `${box.s.r},${box.s.c},${box.e.r},${box.e.c}`;
        box.s = { r: Math.min(box.s.r, m.s.r), c: Math.min(box.s.c, m.s.c) };
        box.e = { r: Math.max(box.e.r, m.e.r), c: Math.max(box.e.c, m.e.c) };
        grew ||= before !== `${box.s.r},${box.s.c},${box.e.r},${box.e.c}`;
      }
    }
    return box;
  };

  /** Move the active cell, or with `extend` the far end, to a cell. */
  const go = (/** @type {Address} */ to, /** @type {boolean} */ extend) => {
    if (extend) end = to;
    else {
      active = snap(to);
      end = active;
    }
  };

  return {
    active: () => active,
    end: () => end,
    mergeAt,
    range,
    /** @param {number} r @param {number} c @param {boolean} [extend] */
    set: (r, c, extend = false) => go({ r, c }, extend),
    /** @param {Address} from @param {Address} to */
    select(from, to) {
      active = snap(from);
      end = to;
    },
    /** @param {number} dr @param {number} dc @param {boolean} extend */
    move: (dr, dc, extend) => go(moved(extend ? end : active, dr, dc), extend),
    /** @param {number} dr @param {number} dc @param {boolean} extend */
    edge: (dr, dc, extend) => go(edge(extend ? end : active, dr, dc), extend),
    /** Home: the row's first column; with Mod the sheet's first cell. */
    home: (/** @type {boolean} */ all, /** @type {boolean} */ extend) =>
      go({ r: all ? first.r : (extend ? end : active).r, c: first.c }, extend),
    /** End: the row's last filled cell; with Mod the last cell of the data. */
    last(/** @type {boolean} */ all, /** @type {boolean} */ extend) {
      const from = extend ? end : active;
      if (all)
        return go(
          { r: Math.max(first.r, sheet.lastRow), c: Math.max(first.c, sheet.lastCol) },
          extend,
        );
      let c = sheet.lastCol;
      while (c > first.c && !sheet.filled(from.r, c)) c--;
      go({ r: from.r, c: Math.max(first.c, c) }, extend);
    },
    /** Count, sum and average of the numbers in the range; undefined for a single cell. */
    stats() {
      const { s, e } = range();
      // One cell, or the merged area of the active cell, is not a range.
      const own = mergeAt(active.r, active.c) ?? { s: active, e: active };
      if (s.r === own.s.r && s.c === own.s.c && e.r === own.e.r && e.c === own.e.c)
        return undefined;
      const [r0, r1, c0, c1] = [rows.from(s.r), rows.until(e.r), cols.from(s.c), cols.until(e.c)];
      let count = 0;
      let sum = 0;
      let seen = 0;
      for (let p = r0; p <= r1 && seen < STATS_LIMIT; p++) {
        const r = rows.index[p] ?? 0;
        for (let q = c0; q <= c1; q++, seen++) {
          const cell = sheet.cell(r, cols.index[q] ?? 0);
          if (cell?.t === "n" && typeof cell.v === "number") {
            count++;
            sum += cell.v;
          }
        }
      }
      return { count, sum, average: count ? sum / count : 0 };
    },
  };
}
