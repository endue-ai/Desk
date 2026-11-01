// The results' DOM: tabs (role=tablist), and for a result set a grid (role=grid) that draws only the
// rows in view, so a hundred thousand rows scroll as fast as ten. A cell cursor the arrows move,
// Shift+arrows select a block, `s` sorts by the cursor's column (and a click on a header), Enter
// says a whole value, Mod+C copies the block as tab-separated text through the copy event. NULL is
// drawn apart from '' and 'NULL'. The Messages tab lists each statement's outcome.

import { el } from "./dom.js";
import { actionFor, extending, pressOf } from "./keys.js";
import { formatRows, numericColumns, sortRows } from "./results.js";

/**
 * @typedef {import("./tabs.js").Tab} Tab
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {{ column: number, direction: "asc" | "desc" } | null} Sort
 */

const ROW = 24;
const OVERSCAN = 10;
const MAX_CH = 48;

/**
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {Act} act
 */
export function createGrid(doc, host, act) {
  /** @type {Tab | null} */
  let tab = null;
  /** @type {(string | null)[][]} */
  let rows = [];
  /** @type {Sort} */
  let sort = null;
  let numeric = /** @type {boolean[]} */ ([]);
  let cursor = { row: 0, col: 0 };
  let anchor = { row: 0, col: 0 };
  let template = "";
  const scroller = el(doc, "div", { class: "scroller" });
  const head = el(doc, "div", { class: "grid-row head", role: "row" });
  const spacer = el(doc, "div", { class: "spacer" });
  const body = el(doc, "div", { class: "body", role: "rowgroup" });
  const grid = el(doc, "div", { class: "grid", role: "grid", tabindex: "0" }, head, spacer);
  spacer.append(body);
  scroller.append(grid);

  const block = () => ({
    top: Math.min(cursor.row, anchor.row),
    bottom: Math.max(cursor.row, anchor.row),
    left: Math.min(cursor.col, anchor.col),
    right: Math.max(cursor.col, anchor.col),
  });

  const cellText = (/** @type {string | null} */ value) =>
    value === null
      ? "NULL"
      : value.length > 500
        ? `${value.slice(0, 500)}…`
        : value.replace(/\r?\n/gu, "↵ ");

  /** Draw the rows that are in view, and the cursor's block. */
  const paint = () => {
    if (!tab?.set) return;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
    const count = Math.ceil((scroller.clientHeight || 480) / ROW) + OVERSCAN * 2;
    const { top, bottom, left, right } = block();
    const drawn = [];
    for (let r = first; r < Math.min(rows.length, first + count); r++) {
      const row = /** @type {(string | null)[]} */ (rows[r]);
      const cells = row.map((value, c) => {
        const chosen = r >= top && r <= bottom && c >= left && c <= right;
        const cell = el(
          doc,
          "div",
          {
            class: `cell${value === null ? " null" : ""}${numeric[c] ? " number" : ""}${chosen ? " chosen" : ""}${r === cursor.row && c === cursor.col ? " cursor" : ""}`,
            role: "gridcell",
            "aria-colindex": String(c + 1),
            ...(chosen ? { "aria-selected": "true" } : {}),
          },
          cellText(value),
        );
        return cell;
      });
      const line = el(
        doc,
        "div",
        {
          class: "grid-row",
          role: "row",
          "aria-rowindex": String(r + 2),
          style: `top: ${r * ROW}px; grid-template-columns: ${template}`,
        },
        ...cells,
      );
      drawn.push(line);
    }
    body.replaceChildren(...drawn);
  };

  /** Draw a tab: a grid for a result set, a list for the messages. */
  const render = (/** @type {Tab | null} */ next, /** @type {boolean} */ fresh) => {
    tab = next;
    if (fresh) {
      sort = null;
      cursor = { row: 0, col: 0 };
      anchor = cursor;
      scroller.scrollTop = 0;
    }
    if (!tab) {
      host.replaceChildren();
      return;
    }
    if (tab.kind === "messages" || !tab.set) {
      const list = el(
        doc,
        "ul",
        { class: "messages" },
        ...(tab.lines ?? []).map((line) =>
          el(doc, "li", { class: `line ${line.level}` }, line.text),
        ),
      );
      host.replaceChildren(list);
      return;
    }
    const set = /** @type {ResultSet} */ (tab.set);
    numeric = numericColumns(set);
    rows = sort ? sortRows(set, sort.column, sort.direction) : set.rows;
    const widths = set.columns.map((name, c) => {
      let width = name.length + 2;
      for (const row of set.rows.slice(0, 200))
        width = Math.max(width, Math.min(MAX_CH, cellText(row[c] ?? "NULL").length + 1));
      return Math.min(MAX_CH, Math.max(6, width));
    });
    // A cell is its text, 16px of padding and a 1px border.
    template = widths.map((w) => `calc(${w}ch + 17px)`).join(" ");
    head.style.gridTemplateColumns = template;
    head.replaceChildren(
      ...set.columns.map((name, c) =>
        el(
          doc,
          "div",
          {
            class: `cell header${numeric[c] ? " number" : ""}`,
            role: "columnheader",
            "aria-colindex": String(c + 1),
            "aria-sort":
              sort?.column === c ? (sort.direction === "asc" ? "ascending" : "descending") : "none",
            "data-col": String(c),
          },
          name,
        ),
      ),
    );
    spacer.style.height = `${rows.length * ROW}px`;
    grid.setAttribute("aria-rowcount", String(rows.length + 1));
    grid.setAttribute("aria-colcount", String(set.columns.length));
    const note =
      set.rows.length === 0
        ? el(
            doc,
            "p",
            { class: "empty" },
            set.columns.length
              ? "No rows."
              : "No rows (this client names no columns for an empty result).",
          )
        : undefined;
    host.replaceChildren(scroller, ...(note ? [note] : []));
    paint();
  };

  /** Sort by a column: ascending, descending, then as it came. */
  const sortBy = (/** @type {number} */ column) => {
    sort =
      sort?.column !== column
        ? { column, direction: "asc" }
        : sort.direction === "asc"
          ? { column, direction: "desc" }
          : null;
    render(tab, false);
  };

  const moveTo = (
    /** @type {number} */ row,
    /** @type {number} */ col,
    /** @type {boolean} */ extend,
  ) => {
    const columns = tab?.set?.columns.length ?? 0;
    cursor = {
      row: Math.max(0, Math.min(rows.length - 1, row)),
      col: Math.max(0, Math.min(columns - 1, col)),
    };
    if (!extend) anchor = cursor;
    const top = cursor.row * ROW;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW * 2 > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = top + ROW * 2 - scroller.clientHeight;
    paint();
  };

  scroller.addEventListener("scroll", paint);
  grid.addEventListener("keydown", (event) => {
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
    const step = /** @type {Record<string, () => void>} */ ({
      down: () => moveTo(cursor.row + 1, cursor.col, false),
      up: () => moveTo(cursor.row - 1, cursor.col, false),
      right: () => moveTo(cursor.row, cursor.col + 1, false),
      left: () => moveTo(cursor.row, cursor.col - 1, false),
      pageDown: () => moveTo(cursor.row + page, cursor.col, false),
      pageUp: () => moveTo(cursor.row - page, cursor.col, false),
      home: () => moveTo(0, cursor.col, false),
      end: () => moveTo(rows.length - 1, cursor.col, false),
      sort: () => sortBy(cursor.col),
      value: () => act("say", valueAt()),
    })[action];
    if (step) step();
    else act(action);
  });
  grid.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const header = target?.closest("[role=columnheader]");
    if (header) {
      sortBy(Number(/** @type {HTMLElement} */ (header).dataset.col));
      return;
    }
    const cell = /** @type {HTMLElement | null} */ (target?.closest("[role=gridcell]"));
    const line = /** @type {HTMLElement | null} */ (cell?.closest("[role=row]"));
    if (!cell || !line) return;
    moveTo(
      Number(line.getAttribute("aria-rowindex")) - 2,
      Number(cell.getAttribute("aria-colindex")) - 1,
      event.shiftKey,
    );
  });
  // With nothing selected the copy event goes to the body, not to the focused grid.
  doc.addEventListener("copy", (event) => {
    if (!grid.contains(doc.activeElement)) return;
    const text = selectedText();
    if (text === undefined) return;
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  });

  /** The cursor's value, whole, as a sentence. */
  const valueAt = () => {
    const value = rows[cursor.row]?.[cursor.col];
    return value === null
      ? "NULL"
      : value === undefined
        ? ""
        : value === ""
          ? "'' (an empty string)"
          : value;
  };

  /** The selected block as tab-separated text. */
  const selectedText = () => {
    if (!tab?.set) return undefined;
    const { top, bottom, left, right } = block();
    const columns = Array.from({ length: right - left + 1 }, (_, i) => left + i);
    return formatRows(tab.set, "tsv", { rows: rows.slice(top, bottom + 1), columns });
  };

  return {
    render,
    focus: () => grid.focus(),
    /** The rows in their order on screen, and the selected block when it is more than a cell. */
    selection() {
      if (!tab?.set) return undefined;
      const { top, bottom, left, right } = block();
      const single = top === bottom && left === right;
      return {
        sorted: rows,
        ...(single
          ? {}
          : {
              rows: Array.from({ length: bottom - top + 1 }, (_, i) => top + i),
              columns: Array.from({ length: right - left + 1 }, (_, i) => left + i),
            }),
      };
    },
  };
}
