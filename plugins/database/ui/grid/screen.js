// The grid on the page: its elements, what each screen cell is (a result cell under the rows'
// order and the columns' layout, or the record view's name and value), and drawing the lane in
// view with the cursor and its block (view-grid-draw.js). Moving the cursor scrolls its row, and
// its column unless pinned, into view. The cursor's cell, its block's rows and the selection (in
// screen order, the shown columns only) are read from here. view-grid.js holds the state
// (GridState); this reads it and moves the cursor.

import { el } from "../dom.js";
import { rowsShown, valueAt } from "../grid-model.js";
import { drawHeader, drawRows, ROW } from "../view-grid-draw.js";
import { laneOf, range, recordLane } from "./lane.js";

/**
 * @typedef {import("../tabs.js").Tab} Tab
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../edits.js").EditState} EditState
 * @typedef {import("./filters.js").SortKey} SortKey
 * @typedef {import("./filters.js").Filter} Filter
 * @typedef {{
 *   edit: EditState | null, server: boolean, ordered?: boolean, key?: string,
 *   sort?: SortKey[], filters?: Filter[],
 * }} Context
 *   `server`: a table's view, whose sort keys and quick filters (`sort`, `filters`) run on the
 *   server; `key` names the result's shape (shapes.js).
 * @typedef {{ row: number, col: number }} Cursor
 * @typedef {{
 *   tab: Tab | null, context: Context, order: number[], text: string, record: boolean,
 *   recordAt: number, cursor: Cursor, anchor: Cursor, toEnd: boolean,
 *   layout: import("./columns.js").Layout, numeric: boolean[], ch: number,
 * }} GridState
 *   `order`: the result rows on screen; `cursor` and `anchor` are screen cells (in the record
 *   view a row is a column of the result).
 */

const OVERSCAN = 10;

/**
 * @param {Document} doc
 * @param {GridState} st
 * @param {{ found(value: string | null): boolean, sortKeys(): SortKey[] }} hooks
 */
export function createScreen(doc, st, hooks) {
  const scroller = el(doc, "div", { class: "scroller" });
  const head = el(doc, "div", { class: "grid-row head", role: "row" });
  const spacer = el(doc, "div", { class: "spacer" });
  const body = el(doc, "div", { class: "body", role: "rowgroup" });
  const grid = el(doc, "div", { class: "grid", role: "grid", tabindex: "0" }, head, spacer);
  spacer.append(body);
  scroller.append(grid);
  /** @type {import("../view-grid-draw.js").Lane} */
  let lane = { cols: [], pinned: 0, lefts: [], template: "" };
  let laneId = "";
  const set = () => /** @type {ResultSet} */ (st.tab?.set);
  const changes = () => (st.context.edit?.status === "ready" ? st.context.edit.changes : null);
  const width = () => scroller.clientWidth || 960;
  /** The result column of a screen column, or of the record view's row. */
  const columnAt = (/** @type {number} */ c) => st.layout.visible[c] ?? 0;
  const cursorColumn = () => columnAt(st.record ? st.cursor.row : st.cursor.col);

  /** What a screen cell is: its value and flags, and the result cell it changes (if any). */
  const cellOf = (/** @type {number} */ r, /** @type {number} */ c) => {
    const s = set();
    const row = st.record ? (st.order[st.recordAt] ?? 0) : (st.order[r] ?? 0);
    const col = columnAt(st.record ? r : c);
    if (st.record && c === 0) {
      const name = s.columns[col] ?? "";
      return { value: name, changed: false, inserted: false, deleted: false, at: undefined };
    }
    return { ...valueAt(s, changes(), row, col), at: { row, col }, col };
  };
  const size = () =>
    st.record
      ? { rows: st.layout.visible.length, cols: 2 }
      : { rows: st.order.length, cols: st.layout.visible.length };
  const block = () => ({
    top: Math.min(st.cursor.row, st.anchor.row),
    bottom: Math.max(st.cursor.row, st.anchor.row),
    left: Math.min(st.cursor.col, st.anchor.col),
    right: Math.max(st.cursor.col, st.anchor.col),
  });

  /** The result rows the cursor's block covers. */
  const blockRows = () => {
    if (st.record) return [st.order[st.recordAt] ?? 0];
    const { top, bottom } = block();
    return st.order.slice(top, bottom + 1);
  };

  /** The cursor's cell for the value viewer: its value, its type and whether it can change. */
  const cursorCell = () => {
    if (!st.tab?.set) return undefined;
    const cell = cellOf(st.cursor.row, st.cursor.col);
    if (!cell.at) return undefined;
    const { edit } = st.context;
    const column = edit?.target?.columns[cell.at.col];
    return {
      ...cell.at,
      value: cell.value,
      name: set().columns[cell.at.col] ?? "",
      type: column?.type ?? "",
      editable: edit?.status === "ready" && (column?.known ?? false) && !cell.deleted,
      reason: edit?.status === "refused" ? edit.reason : "",
    };
  };

  /**
   * The rows in their order on screen (with pending changes), the block's rows and columns when it
   * is more than a cell (else the shown columns when some are hidden or moved), and `visible`, the
   * shown columns in screen order.
   */
  const selection = () => {
    if (!st.tab?.set) return undefined;
    const s = set();
    const { top, bottom, left, right } = block();
    const { visible } = st.layout;
    if (st.record)
      return {
        sorted: rowsShown(s, changes(), [st.order[st.recordAt] ?? 0]),
        rows: [0],
        columns: range(top, bottom + 1).map(columnAt),
      };
    const sorted = rowsShown(s, changes(), st.order);
    const natural = visible.length === s.columns.length && visible.every((c, i) => c === i);
    const shown = { sorted, visible: [...visible] };
    if (top === bottom && left === right)
      return natural ? shown : { ...shown, columns: [...visible] };
    return {
      ...shown,
      rows: range(top, bottom + 1),
      columns: range(left, right + 1).map(columnAt),
    };
  };

  /** The header row of the lane: the result's columns, or Column and the record's number. */
  const drawHead = () => {
    const { layout } = st;
    const heads = st.record
      ? [
          { name: "Column", key: "", number: false },
          { name: `Row ${st.recordAt + 1} of ${st.order.length}`, key: "", number: false },
        ]
      : layout.visible.map((c) => ({
          name: set().columns[c] ?? "",
          key: layout.keys[c] ?? "",
          number: st.numeric[c] ?? false,
        }));
    head.style.gridTemplateColumns = lane.template;
    const sort = hooks.sortKeys();
    head.replaceChildren(...drawHeader(doc, heads, { lane, record: st.record, sort }));
  };

  /** Draw the rows and columns that are in view, and the cursor's block. */
  const paint = () => {
    if (!st.tab?.set) return;
    const names = () => st.layout.visible.map((c) => set().columns[c] ?? "");
    const next = st.record
      ? recordLane(names(), st.ch)
      : laneOf(st.layout, scroller.scrollLeft, width());
    const id = `${next.cols.join(",")}|${next.template}`;
    if (id !== laneId) {
      lane = next;
      laneId = id;
      drawHead();
    }
    const from = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
    const count = Math.ceil((scroller.clientHeight || 480) / ROW) + OVERSCAN * 2;
    const to = Math.min(size().rows, from + count);
    const number = (/** @type {number} */ r, /** @type {number} */ c) =>
      st.record
        ? c === 1 && (st.numeric[columnAt(r)] ?? false)
        : (st.numeric[columnAt(c)] ?? false);
    const { cursor, record } = st;
    const found = hooks.found;
    body.replaceChildren(
      ...drawRows(doc, {
        from,
        to,
        lane,
        cell: cellOf,
        block: block(),
        cursor,
        number,
        found,
        record,
      }),
    );
  };

  /** Keep a screen column in view, unless it is pinned. */
  const reveal = (/** @type {number} */ c) => {
    const { layout } = st;
    if (st.record || c < layout.pinned) return;
    const left = (layout.offsets[c] ?? 0) - layout.pinnedWidth;
    const right = (layout.offsets[c] ?? 0) + (layout.widths[c] ?? 0);
    if (left < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left);
    else if (right > scroller.scrollLeft + width()) scroller.scrollLeft = right - width();
  };

  /** Move the cursor to a screen cell (`extend` keeps the block's anchor) and draw. */
  const moveTo = (
    /** @type {number} */ row,
    /** @type {number} */ col,
    /** @type {boolean} */ extend,
  ) => {
    const { rows: count, cols } = size();
    st.cursor = {
      row: Math.max(0, Math.min(count - 1, row)),
      col: Math.max(0, Math.min(cols - 1, col)),
    };
    if (!extend) st.anchor = st.cursor;
    const top = st.cursor.row * ROW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW * 2 > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = top + ROW * 2 - scroller.clientHeight;
    reveal(st.cursor.col);
    paint();
  };

  /** A character's width in the grid's font, once the grid is on the page. */
  const measure = () => {
    if (st.ch > 0) return st.ch;
    if (!grid.isConnected) return 7;
    const probe = el(doc, "span", { class: "probe", "aria-hidden": "true" }, "0".repeat(20));
    grid.append(probe);
    const w = probe.getBoundingClientRect().width / 20;
    probe.remove();
    st.ch = w > 0 ? w : 7;
    return st.ch;
  };

  return {
    scroller,
    head,
    spacer,
    body,
    grid,
    set,
    changes,
    columnAt,
    cursorColumn,
    cellOf,
    size,
    block,
    paint,
    moveTo,
    measure,
    blockRows,
    cursorCell,
    selection,
    /** The lane is drawn again on the next paint (the columns or the mode changed). */
    redraw() {
      laneId = "";
      paint();
    },
  };
}
