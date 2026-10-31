// The grid: a virtual window over one sheet. A scroller as large as the sheet takes the wheel, the
// scroll bars and the mouse; a layer over it holds only the rows and cells on screen (paint.js).
// Frozen rows and columns and the headers are painted above the rest, so the scrolling cells pass
// under them. One listener each serves scroll, mouse and keys, whatever the size of the sheet.
import { keyMove } from "./keys.js";
import { axis } from "./layout.js";
import { columnName, DEFAULT_HEIGHT } from "./model.js";
import { createPool, paintCell, place } from "./paint.js";
import { createSelection } from "./selection.js";

/**
 * @typedef {import("./model.js").Sheet} Sheet
 * @typedef {import("./model.js").Address} Address
 * @typedef {import("./layout.js").Axis} Axis
 * @typedef {ReturnType<typeof createSelection>} Selection
 * @typedef {{ active: Address, end: Address, top: number, left: number }} Place
 */

const HEAD = 22;
/** Rows and columns drawn past each edge, so a scroll shows them before the next frame. */
const OVERSCAN = 3;
export const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2];

/** Pixels from the start of position p0 to the end of p1 on an axis. */
const span = (/** @type {Axis} */ ax, /** @type {number} */ p0, /** @type {number} */ p1) =>
  (ax.offset[p1 + 1] ?? 0) - (ax.offset[p0] ?? 0);

/** The positions on screen: the frozen ones, then the window the scroll shows. */
function windowOf(
  /** @type {Axis} */ ax,
  /** @type {number} */ fixed,
  /** @type {number} */ scroll,
  /** @type {number} */ room,
) {
  const out = [];
  for (let p = 0; p < fixed; p++) out.push(p);
  if (ax.count === 0) return out;
  const start = Math.max(fixed, ax.at(scroll + (ax.offset[fixed] ?? 0)) - OVERSCAN);
  // A frame smaller than its headers still draws a few rows past the frozen ones.
  const stop = Math.min(ax.count - 1, Math.max(start, ax.at(scroll + room)) + OVERSCAN);
  for (let p = start; p <= stop; p++) out.push(p);
  return out;
}

/**
 * @param {Document} doc
 * @param {{ root: HTMLElement, scroller: HTMLElement, sizer: HTMLElement, layer: HTMLElement }} parts
 * @param {{ changed(): void }} actions
 */
export function createGrid(doc, { root, scroller, sizer, layer }, { changed }) {
  /** @type {Sheet | undefined} */
  let sheet;
  /** @type {Axis} */
  let rows = axis(0, Number, Boolean);
  let cols = rows;
  /** @type {Selection | undefined} */
  let selection;
  let zoom = 1;
  let headW = 40;
  let head = HEAD;
  const pool = createPool(doc, layer);

  /** Frozen rows and columns, as positions on the axes. */
  const frozen = () => ({
    rows: Math.max(0, rows.from(sheet?.frozen.rows ?? 0)),
    cols: Math.max(0, cols.from(sheet?.frozen.cols ?? 0)),
  });

  const render = () => {
    const s = sheet;
    if (!s || !selection) return;
    const viewW = scroller.clientWidth;
    const viewH = scroller.clientHeight;
    layer.style.width = `${viewW}px`;
    layer.style.height = `${viewH}px`;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const fixed = frozen();
    const rowPos = windowOf(rows, fixed.rows, sy, viewH - head);
    const colPos = windowOf(cols, fixed.cols, sx, viewW - headW);
    const { s: from, e: to } = selection.range();
    const active = selection.active();
    const xOf = (/** @type {number} */ q) =>
      headW + (cols.offset[q] ?? 0) - (q < fixed.cols ? 0 : sx);
    const yOf = (/** @type {number} */ p) =>
      head + (rows.offset[p] ?? 0) - (p < fixed.rows ? 0 : sy);
    pool.begin();

    place(pool.corner, 0, 0, headW, head);
    for (const q of colPos) {
      const c = cols.index[q] ?? 0;
      const el = pool.colHead(c, columnName(c));
      place(el, xOf(q), 0, span(cols, q, q), head);
      el.style.zIndex = q < fixed.cols ? "2" : "1";
      el.classList.toggle("on", c >= from.c && c <= to.c);
    }

    /** The width of the empty cells after positions[i] on row r, which its text may run over. */
    const roomAfter = (
      /** @type {number} */ r,
      /** @type {number[]} */ positions,
      /** @type {number} */ i,
    ) => {
      let room = 0;
      for (let k = i + 1; k < positions.length && room < 2000; k++) {
        const q = positions[k] ?? 0;
        if (q !== (positions[k - 1] ?? 0) + 1) break;
        const c = cols.index[q] ?? 0;
        if (s.filled(r, c) || s.style(r, c)?.fill || selection?.mergeAt(r, c)) break;
        room += span(cols, q, q);
      }
      return room;
    };
    /** Paint row position p's cells at the column positions given, merged areas as one cell. */
    const paintRow = (/** @type {number} */ p, /** @type {number[]} */ positions) => {
      const r = rows.index[p] ?? 0;
      const line = pool.line(r);
      place(line.el, 0, yOf(p), 0, span(rows, p, p));
      line.el.style.zIndex = p < fixed.rows ? "2" : "1";
      positions.forEach((q, i) => {
        const c = cols.index[q] ?? 0;
        const merge = selection?.mergeAt(r, c);
        if (merge && (merge.s.r !== r || merge.s.c !== c)) return;
        const w = merge ? span(cols, q, cols.until(merge.e.c)) : span(cols, q, q);
        const h = merge ? span(rows, p, rows.until(merge.e.r)) : span(rows, p, p);
        const el = pool.cell(line, r, c);
        const pinned = p < fixed.rows || q < fixed.cols;
        el.style.zIndex = q < fixed.cols ? "2" : "1";
        paintCell(el, s, r, c, [xOf(q), 0, w, h], {
          selected: r >= from.r && r <= to.r && c >= from.c && c <= to.c,
          active: active.r === r && active.c === c,
          fixed: pinned,
          size: 12 * zoom,
          room: merge || pinned || s.cell(r, c)?.t !== "s" ? 0 : roomAfter(r, positions, i),
        });
      });
      return line;
    };

    for (const p of rowPos) {
      const line = paintRow(p, colPos);
      const r = rows.index[p] ?? 0;
      line.head.hidden = false;
      place(line.head, 0, 0, headW, span(rows, p, p));
      line.head.classList.toggle("on", r >= from.r && r <= to.r);
    }
    // A merged area that starts above or left of the window still shows its part in the window.
    const [r0 = 0, r1 = 0] = [rows.index[rowPos[0] ?? 0], rows.index[rowPos.at(-1) ?? 0]];
    const [c0 = 0, c1 = 0] = [cols.index[colPos[0] ?? 0], cols.index[colPos.at(-1) ?? 0]];
    for (const m of s.merges) {
      if (m.e.r < r0 || m.s.r > r1 || m.e.c < c0 || m.s.c > c1 || pool.painted(m.s.r, m.s.c))
        continue;
      const p = rows.from(m.s.r);
      const q = cols.from(m.s.c);
      if (p >= rows.count || q >= cols.count) continue;
      const line = paintRow(p, [q]);
      if (!rowPos.includes(p)) line.head.hidden = true;
    }
    pool.sweep();
    const id = `cell-${active.r}-${active.c}`;
    if (pool.painted(active.r, active.c)) root.setAttribute("aria-activedescendant", id);
    else root.removeAttribute("aria-activedescendant");
  };

  /** Scroll so that a cell is on screen, unless it is in a frozen row or column. */
  const reveal = (/** @type {Address} */ at) => {
    const fixed = frozen();
    const p = rows.from(at.r);
    const q = cols.from(at.c);
    if (p >= fixed.rows && p < rows.count) {
      const top = (rows.offset[p] ?? 0) - (rows.offset[fixed.rows] ?? 0);
      const bottom = (rows.offset[p + 1] ?? 0) - (scroller.clientHeight - head);
      if (scroller.scrollTop > top) scroller.scrollTop = top;
      else if (scroller.scrollTop < bottom) scroller.scrollTop = Math.min(top, bottom);
    }
    if (q >= fixed.cols && q < cols.count) {
      const left = (cols.offset[q] ?? 0) - (cols.offset[fixed.cols] ?? 0);
      const right = (cols.offset[q + 1] ?? 0) - (scroller.clientWidth - headW);
      if (scroller.scrollLeft > left) scroller.scrollLeft = left;
      else if (scroller.scrollLeft < right) scroller.scrollLeft = Math.min(left, right);
    }
  };

  /** After the selection moved: keep its moving end on screen, draw, and tell the view. */
  const moved = (/** @type {boolean} */ extend) => {
    if (!selection) return;
    reveal(extend ? selection.end() : selection.active());
    render();
    changed();
  };

  /** The axes and the sizes that follow from the sheet and the zoom. */
  const layout = () => {
    const s = sheet;
    if (!s) return;
    rows = axis(s.rows, s.height, s.hiddenRow, zoom);
    cols = axis(s.cols, s.width, s.hiddenCol, zoom);
    head = Math.round(HEAD * zoom);
    headW = Math.round(Math.max(40, String(s.rows).length * 8 + 16) * zoom);
    sizer.style.width = `${headW + cols.total}px`;
    sizer.style.height = `${head + rows.total}px`;
    layer.style.fontSize = `${12 * zoom}px`;
    root.setAttribute("aria-rowcount", String(s.rows + 1));
    root.setAttribute("aria-colcount", String(s.cols + 1));
    root.setAttribute("aria-label", s.name);
  };

  /** The cell under the mouse, and whether it is over a header; nothing over the scroll bars. */
  const hit = (/** @type {MouseEvent} */ event) => {
    const rect = scroller.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (!sheet || x >= scroller.clientWidth || y >= scroller.clientHeight) return undefined;
    const fixed = frozen();
    const cx = x - headW;
    const cy = y - head;
    const fw = cols.offset[fixed.cols] ?? 0;
    const fh = rows.offset[fixed.rows] ?? 0;
    const c = cols.index[cols.at(cx < fw ? cx : cx + scroller.scrollLeft)] ?? 0;
    const r = rows.index[rows.at(cy < fh ? cy : cy + scroller.scrollTop)] ?? 0;
    return { r, c, rowHead: x < headW, colHead: y < head };
  };
  const first = (/** @type {Axis} */ ax) => ax.index[0] ?? 0;
  const last = (/** @type {Axis} */ ax) => ax.index[ax.count - 1] ?? 0;

  let dragging = false;
  const drag = (/** @type {MouseEvent} */ event) => {
    const at = dragging ? hit(event) : undefined;
    if (!at || !selection) return;
    selection.set(at.r, at.c, true);
    moved(true);
  };
  const stop = () => {
    dragging = false;
    doc.removeEventListener("mousemove", drag);
  };
  scroller.addEventListener("mousedown", (event) => {
    const at = event.button === 0 ? hit(event) : undefined;
    if (!at || !selection) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    // A header selects its whole row or column; the corner selects everything.
    const top = at.colHead ? first(rows) : at.r;
    const left = at.rowHead ? first(cols) : at.c;
    if (at.colHead || at.rowHead)
      selection.select(
        { r: top, c: left },
        { r: at.colHead ? last(rows) : at.r, c: at.rowHead ? last(cols) : at.c },
      );
    else selection.set(at.r, at.c, event.shiftKey);
    render();
    changed();
    dragging = !at.rowHead && !at.colHead;
    doc.addEventListener("mousemove", drag);
    doc.addEventListener("mouseup", stop, { once: true });
  });
  scroller.addEventListener("scroll", render);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => render()).observe(scroller);

  root.addEventListener("keydown", (event) => {
    if (!selection) return;
    const fixedH = rows.offset[frozen().rows] ?? 0;
    const page = Math.floor((scroller.clientHeight - head - fixedH) / (DEFAULT_HEIGHT * zoom));
    const done = keyMove(event, selection, Math.max(1, page - 1));
    if (!done) return;
    event.preventDefault();
    moved(done.extend);
  });

  return {
    /**
     * Show a sheet, where it was left when a place is given.
     * @param {Sheet} next
     * @param {Place} [at]
     */
    show(next, at) {
      sheet = next;
      layout();
      selection = createSelection(next, rows, cols);
      if (at) selection.select(at.active, at.end);
      scroller.scrollTop = at?.top ?? 0;
      scroller.scrollLeft = at?.left ?? 0;
      render();
      changed();
    },
    /** @returns {Place | undefined} */
    place: () =>
      selection && {
        active: selection.active(),
        end: selection.end(),
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
      },
    selection: () => selection,
    axes: () => ({ rows, cols }),
    /** Go to a cell, as find does. */
    go(/** @type {number} */ r, /** @type {number} */ c) {
      selection?.set(r, c);
      moved(false);
    },
    /** Mod+= and Mod+- step through ZOOMS, Mod+0 goes back to 100 %; returns the zoom. */
    zoom(/** @type {number} */ by) {
      const at = ZOOMS.indexOf(zoom);
      zoom = by === 0 ? 1 : (ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + by))] ?? 1);
      layout();
      if (selection) reveal(selection.active());
      render();
      return zoom;
    },
    clear() {
      sheet = undefined;
      selection = undefined;
      pool.clear();
    },
  };
}
