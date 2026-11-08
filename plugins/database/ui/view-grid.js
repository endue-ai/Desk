// The results' DOM: for a result set a grid (role=grid) that draws only the rows in view, so a
// hundred thousand rows scroll as fast as ten. A cell cursor the arrows move, Shift+arrows select a
// block; `s` sorts by the cursor's column (on the server for a table's view), `/` filters the rows
// on screen, `t` shows the cursor's row as a record. Enter or F2 edits a cell of a result that can
// be changed (pending until Submit), `n` sets NULL, `+` adds a row, Delete marks rows for deletion,
// `u` takes a row's changes back; changed cells, added and deleted rows are drawn as a diff. `v`
// opens the value viewer, Mod+C copies the block as tab-separated text. NULL is drawn apart from ''
// and 'NULL'. A plan tab draws the plan tree, the Messages tab each statement's outcome.

import { el } from "./dom.js";
import { rowOrder, rowsShown, valueAt, widths } from "./grid-model.js";
import { actionFor, extending, pressOf } from "./keys.js";
import { formatRows, numericColumns } from "./results.js";
import { createCellEditor } from "./view-cell.js";
import { drawHeader, drawRows, ROW } from "./view-grid-draw.js";
import { planView } from "./view-plan.js";

/**
 * @typedef {import("./tabs.js").Tab} Tab
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./edits.js").EditState} EditState
 * @typedef {import("./grid-model.js").Sort} Sort
 * @typedef {{ edit: EditState | null, server: boolean, ordered?: boolean }} Context
 *   `server`: a table's view, whose sort is the server's ORDER BY; `ordered`: it has one.
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const OVERSCAN = 10;

/**
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {Act} act
 */
export function createGrid(doc, host, act) {
  /** @type {Tab | null} */
  let tab = null;
  /** @type {Context} */
  let context = { edit: null, server: false };
  /** @type {number[]} */
  let order = [];
  /** @type {Sort} */
  let sort = null;
  let filter = "";
  let record = false;
  let recordAt = 0;
  let numeric = /** @type {boolean[]} */ ([]);
  let cursor = { row: 0, col: 0 };
  let anchor = { row: 0, col: 0 };
  let template = "";
  let toEnd = false;
  const scroller = el(doc, "div", { class: "scroller" });
  const head = el(doc, "div", { class: "grid-row head", role: "row" });
  const spacer = el(doc, "div", { class: "spacer" });
  const body = el(doc, "div", { class: "body", role: "rowgroup" });
  const grid = el(doc, "div", { class: "grid", role: "grid", tabindex: "0" }, head, spacer);
  spacer.append(body);
  scroller.append(grid);
  const changes = () => (context.edit?.status === "ready" ? context.edit.changes : null);
  const editable = () => context.edit?.status === "ready";
  const set = () => /** @type {ResultSet} */ (tab?.set);

  /** What a screen cell is: its value and flags, and the result cell it changes (if any). */
  const cellOf = (/** @type {number} */ r, /** @type {number} */ c) => {
    const s = set();
    if (record) {
      const row = order[recordAt] ?? 0;
      if (c === 0)
        return {
          value: s.columns[r] ?? "",
          changed: false,
          inserted: false,
          deleted: false,
          at: undefined,
        };
      return { ...valueAt(s, changes(), row, r), at: { row, col: r } };
    }
    const row = order[r] ?? 0;
    return { ...valueAt(s, changes(), row, c), at: { row, col: c } };
  };
  const size = () =>
    record
      ? { rows: set().columns.length, cols: 2 }
      : { rows: order.length, cols: set().columns.length };

  const block = () => ({
    top: Math.min(cursor.row, anchor.row),
    bottom: Math.max(cursor.row, anchor.row),
    left: Math.min(cursor.col, anchor.col),
    right: Math.max(cursor.col, anchor.col),
  });

  /** Draw the rows that are in view, and the cursor's block. */
  const paint = () => {
    if (!tab?.set) return;
    const from = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
    const count = Math.ceil((scroller.clientHeight || 480) / ROW) + OVERSCAN * 2;
    const { rows, cols } = size();
    const to = Math.min(rows, from + count);
    body.replaceChildren(
      ...drawRows(doc, {
        from,
        to,
        cols,
        cell: cellOf,
        block: block(),
        cursor,
        numeric,
        record,
        template,
      }),
    );
  };

  /** The header row: the result's columns, or Column and the record's number. */
  const drawHead = () => {
    const s = set();
    const names = record ? ["Column", `Row ${recordAt + 1} of ${order.length}`] : s.columns;
    const w = record ? [Math.max(8, ...s.columns.map((n) => n.length + 2)), 60] : widths(s);
    template = w.map((n) => `calc(${n}ch + 17px)`).join(" ");
    head.style.gridTemplateColumns = template;
    head.replaceChildren(...drawHeader(doc, names, { numeric, record, sort }));
  };

  /** Lay the grid out again after a change of rows, sort, filter or mode. */
  const relayout = () => {
    const s = set();
    order = rowOrder(s, changes(), context.server ? null : sort, filter);
    recordAt = Math.max(0, Math.min(recordAt, order.length - 1));
    numeric = numericColumns(s);
    drawHead();
    const { rows } = size();
    spacer.style.height = `${rows * ROW}px`;
    grid.setAttribute("aria-rowcount", String(rows + 1));
    grid.setAttribute("aria-colcount", String(size().cols));
    if (toEnd && !record) {
      toEnd = false;
      cursor = { row: Math.max(0, order.length - 1), col: 0 };
      anchor = cursor;
    }
    cursor = {
      row: Math.min(cursor.row, Math.max(0, rows - 1)),
      col: Math.min(cursor.col, Math.max(0, size().cols - 1)),
    };
    const note =
      rows === 0
        ? el(
            doc,
            "p",
            { class: "empty" },
            s.columns.length
              ? filter
                ? "No row holds that text."
                : "No rows."
              : "No rows (this client names no columns for an empty result).",
          )
        : undefined;
    host.replaceChildren(scroller, ...(note ? [note] : []));
    paint();
  };

  /** Draw a tab: a grid for a result set, a plan, or the messages. */
  const render = (
    /** @type {Tab | null} */ next,
    /** @type {boolean} */ fresh,
    /** @type {Context} */ given,
  ) => {
    tab = next;
    context = given;
    if (fresh) {
      if (!context.server || !context.ordered) sort = null;
      filter = "";
      cursor = { row: 0, col: 0 };
      anchor = cursor;
      recordAt = 0;
      scroller.scrollTop = 0;
    }
    if (!tab) return host.replaceChildren();
    if (tab.kind === "plan" && tab.plan) return host.replaceChildren(planView(doc, tab.plan));
    if (tab.kind === "messages" || !tab.set) {
      const lines = (tab.lines ?? []).map((line) =>
        el(doc, "li", { class: `line ${line.level}` }, line.text),
      );
      return host.replaceChildren(el(doc, "ul", { class: "messages" }, ...lines));
    }
    relayout();
  };

  const moveTo = (
    /** @type {number} */ row,
    /** @type {number} */ col,
    /** @type {boolean} */ extend,
  ) => {
    const { rows, cols } = size();
    cursor = {
      row: Math.max(0, Math.min(rows - 1, row)),
      col: Math.max(0, Math.min(cols - 1, col)),
    };
    if (!extend) anchor = cursor;
    const top = cursor.row * ROW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW * 2 > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = top + ROW * 2 - scroller.clientHeight;
    paint();
  };

  /** Sort by a column: ascending, descending, then as it came (a table's view asks the server). */
  const sortBy = (/** @type {number} */ column) => {
    if (record) return;
    sort =
      sort?.column !== column
        ? { column, direction: "asc" }
        : sort.direction === "asc"
          ? { column, direction: "desc" }
          : null;
    if (context.server)
      act("sort", sort ? { column: set().columns[column], direction: sort.direction } : null);
    relayout();
  };

  /** The result rows the cursor's block covers. */
  const blockRows = () => {
    if (record) return [order[recordAt] ?? 0];
    const { top, bottom } = block();
    return order.slice(top, bottom + 1);
  };

  const editor = createCellEditor(
    doc,
    grid,
    (editing, value, move) => {
      if (value !== undefined) act("editCell", editing.row, editing.col, value);
      if (move === "down") moveTo(cursor.row + 1, cursor.col, false);
      else if (move === "right") moveTo(cursor.row, cursor.col + 1, false);
    },
    () => grid.focus(),
  );

  /** The cursor's cell for the value viewer: its value, its type and whether it can change. */
  const cursorCell = () => {
    if (!tab?.set) return undefined;
    const cell = cellOf(cursor.row, cursor.col);
    if (!cell.at) return undefined;
    const column = context.edit?.target?.columns[cell.at.col];
    return {
      ...cell.at,
      value: cell.value,
      name: set().columns[cell.at.col] ?? "",
      type: column?.type ?? "",
      editable: editable() && (column?.known ?? false) && !cell.deleted,
      reason: context.edit?.status === "refused" ? context.edit.reason : "",
    };
  };

  const startEdit = () => {
    const cell = cursorCell();
    if (!cell) return;
    if (!cell.editable) return act("value", cell);
    const target = body.querySelector(
      `[aria-rowindex="${cursor.row + 2}"] [aria-colindex="${cursor.col + 1}"]`,
    );
    if (target) editor.open(/** @type {HTMLElement} */ (target), cell);
  };

  scroller.addEventListener("scroll", paint);
  grid.addEventListener("keydown", (event) => {
    if (editor.active()) return;
    const press = pressOf(event);
    const page = Math.max(1, Math.floor((scroller.clientHeight || 480) / ROW) - 1);
    const moves = /** @type {Record<string, [number, number]>} */ ({
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    });
    if (extending(press)) {
      const [dr, dc] = moves[press.key] ?? [0, 0];
      event.preventDefault();
      moveTo(cursor.row + dr, cursor.col + dc, true);
      return;
    }
    const action = actionFor("grid", press);
    if (!action) return;
    event.preventDefault();
    const records = (/** @type {number} */ step) => {
      recordAt = Math.max(0, Math.min(order.length - 1, recordAt + step));
      relayout();
    };
    const step = /** @type {Record<string, () => unknown>} */ ({
      down: () => moveTo(cursor.row + 1, cursor.col, false),
      up: () => moveTo(cursor.row - 1, cursor.col, false),
      right: () => moveTo(cursor.row, cursor.col + 1, false),
      left: () => moveTo(cursor.row, cursor.col - 1, false),
      pageDown: () => (record ? records(1) : moveTo(cursor.row + page, cursor.col, false)),
      pageUp: () => (record ? records(-1) : moveTo(cursor.row - page, cursor.col, false)),
      home: () => moveTo(0, cursor.col, false),
      end: () => moveTo(size().rows - 1, cursor.col, false),
      sort: () => sortBy(cursor.col),
      edit: startEdit,
      value: () => act("value", cursorCell()),
      null: () => {
        const cell = cursorCell();
        if (cell?.editable) act("editCell", cell.row, cell.col, null);
        else act("say", cell?.reason || "This cell cannot change.");
      },
      addRow: () => {
        toEnd = true;
        act("addRow");
      },
      deleteRows: () => act("deleteRows", blockRows()),
      revertRows: () => act("revertRows", blockRows()),
      record: () => toggleRecord(),
    })[action];
    if (step) step();
    else act(action);
  });
  grid.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const header = target?.closest("[role=columnheader]");
    if (header) return sortBy(Number(/** @type {HTMLElement} */ (header).dataset.col));
    const cell = /** @type {HTMLElement | null} */ (target?.closest("[role=gridcell]"));
    const line = /** @type {HTMLElement | null} */ (cell?.closest("[role=row]"));
    if (!cell || !line) return;
    moveTo(
      Number(line.getAttribute("aria-rowindex")) - 2,
      Number(cell.getAttribute("aria-colindex")) - 1,
      event.shiftKey,
    );
  });
  grid.addEventListener("dblclick", (event) => {
    if (/** @type {HTMLElement | null} */ (event.target)?.closest("[role=gridcell]")) startEdit();
  });
  // With nothing selected the copy event goes to the body, not to the focused grid.
  doc.addEventListener("copy", (event) => {
    if (!grid.contains(doc.activeElement) || editor.active() || !tab?.set) return;
    const picked = selection();
    if (!picked) return;
    const rows = picked.rows
      ? picked.rows.map((i) => picked.sorted[i] ?? [])
      : [picked.sorted[cursor.row] ?? []];
    const columns = picked.columns ?? [record ? cursor.row : cursor.col];
    event.clipboardData?.setData("text/plain", formatRows(set(), "tsv", { rows, columns }));
    event.preventDefault();
  });

  const toggleRecord = () => {
    if (!tab?.set) return record;
    if (!record) recordAt = order[cursor.row] !== undefined ? cursor.row : 0;
    record = !record;
    cursor = { row: 0, col: record ? 1 : 0 };
    anchor = cursor;
    relayout();
    act("recordChanged", record);
    return record;
  };

  /** The rows in their order on screen (with pending changes), and the block when it is more than a cell. */
  const selection = () => {
    if (!tab?.set) return undefined;
    const s = set();
    if (record) {
      const sorted = rowsShown(s, changes(), [order[recordAt] ?? 0]);
      const { top, bottom } = block();
      return {
        sorted,
        rows: [0],
        columns: Array.from({ length: bottom - top + 1 }, (_, i) => top + i),
      };
    }
    const { top, bottom, left, right } = block();
    const sorted = rowsShown(s, changes(), order);
    if (top === bottom && left === right) return { sorted };
    return {
      sorted,
      rows: Array.from({ length: bottom - top + 1 }, (_, i) => top + i),
      columns: Array.from({ length: right - left + 1 }, (_, i) => left + i),
    };
  };

  return {
    render,
    focus: () => grid.focus(),
    selection,
    cursorCell,
    toggleRecord,
    recording: () => record,
    /** Keep the rows holding `text` on screen. */
    filter(/** @type {string} */ text) {
      filter = text;
      cursor = { row: 0, col: cursor.col };
      anchor = cursor;
      if (tab?.set) relayout();
    },
  };
}
