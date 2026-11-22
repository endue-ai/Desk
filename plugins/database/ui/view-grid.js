// The results' DOM: for a result set a grid (role=grid) that draws only the rows and columns in
// view, so a hundred thousand rows or hundreds of columns scroll as fast as ten. A cell cursor the
// arrows move, Shift+arrows select a block; `s` sorts by the cursor's column and `S` adds it as the
// next key (on the server for a table's view), `/` filters the rows on screen, `f` opens the cell's
// menu of quick filters and column actions, `h`, `<`, `>`, `P`, `w` hide, move, pin and fit columns,
// Mod+F finds, `t` shows the cursor's row as a record (grid/keys.js). Enter, F2 or a double click
// edits a cell of a result that can be changed (pending until Submit), `n` sets NULL, `+` adds a
// row, Delete marks rows for deletion, `u` takes a row's changes back; changes are drawn as a diff.
// Mod+V pastes from the caret, `D` duplicates rows, `"` fills down, `n` on a block clears it, Mod+Z
// takes the last change back (PG-43, grid/paste.js, features/paste/). `v` opens the value viewer,
// Mod+C copies the block as tab-separated text. A foreign key's cells are links: `g` or Mod+click
// follows one, `r` lists the rows pointing at the row, `b` goes back, Enter searches the referenced
// table (PG-41, links/). Plan, Messages and Map tabs draw the plan tree, each statement's outcome
// and the shapes (geo/map-view.js). The parts live in grid/.

import { el } from "./dom.js";
import { createMaps } from "./geo/map-view.js";
import { emptyColumns, layoutOf } from "./grid/columns.js";
import { createFinder } from "./grid/finder.js";
import { attachHeader } from "./grid/header.js";
import { createGridKeys } from "./grid/keys.js";
import { range } from "./grid/lane.js";
import { createCellMenu } from "./grid/menu.js";
import { createGridPaste } from "./grid/paste.js";
import { attachPointer } from "./grid/pointer.js";
import { createRowsClient } from "./grid/rows-client.js";
import { createScreen } from "./grid/screen.js";
import { createShapes } from "./grid/shapes.js";
import { createShaping } from "./grid/shaping.js";
import { createStrip } from "./grid/strip.js";
import { defaultWidths } from "./grid-model.js";
import { createGridLinks } from "./links/grid-links.js";
import { lineOf } from "./message-line.js";
import { numericColumns } from "./results.js";
import { createCellEditor } from "./view-cell.js";
import { ROW } from "./view-grid-draw.js";
import { planView } from "./view-plan.js";

/**
 * @typedef {import("./tabs.js").Tab} Tab
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./grid/screen.js").Context} Context
 * @typedef {import("./grid/screen.js").GridState} GridState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {import("./grid/rows-client.js").StartWorker} StartWorker
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {Act} act
 * @param {{ startWorker?: StartWorker }} [options] The worker for large results (main.js).
 */
export function createGrid(doc, host, act, options = {}) {
  /** @type {GridState} */
  const st = {
    tab: null,
    context: { edit: null, server: false },
    order: [],
    text: "",
    record: false,
    recordAt: 0,
    cursor: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
    toEnd: false,
    layout: layoutOf([], emptyColumns(), []),
    numeric: [],
    ch: 0,
  };
  let asked = 0;
  let shownKey = "";
  /** The result set `st.order` orders. */
  let orderedFor = /** @type {ResultSet | null} */ (null);
  /** The default widths, measured once per result set and character width. */
  let measured = {
    set: /** @type {ResultSet | null} */ (null),
    ch: 0,
    px: /** @type {number[]} */ ([]),
  };
  const links = createGridLinks(act, () => screen.redraw());
  const screen = createScreen(doc, st, {
    found: (value) => finder.marks(value),
    sortKeys: () => shaping.sortKeys(),
    link: (col) => links.title(col),
    startWorker: options.startWorker,
  });
  const { scroller, head, spacer, body, grid, set, changes, cellOf, size, moveTo } = screen;
  const { blockRows, cursorCell, selection } = screen;
  const rows = createRowsClient(options.startWorker);
  const shapes = createShapes(act, (key) => key === shape().key && st.tab?.set && relayout());
  const shape = () => shapes.of(st.context.key ?? "result:none");
  // A Map tab, and the row its Show in grid puts the cursor on next (PG-46).
  const maps = createMaps(doc, act, options.startWorker);
  let goto = /** @type {number | undefined} */ (undefined);
  const say = (/** @type {string | undefined} */ words) => (words ? act("say", words) : undefined);

  /** The rows' order changed: size the grid for them and draw. */
  const arrange = () => {
    const s = set();
    st.recordAt = Math.max(0, Math.min(st.recordAt, st.order.length - 1));
    strip.draw(shaping.filters(), st.context.server);
    const { rows: count, cols } = size();
    spacer.style.height = `${count * ROW}px`;
    grid.setAttribute("aria-rowcount", String(count + 1));
    grid.setAttribute("aria-colcount", String(cols));
    if (st.toEnd && !st.record) {
      st.toEnd = false;
      st.cursor = { row: Math.max(0, st.order.length - 1), col: 0 };
      st.anchor = st.cursor;
    }
    const at = st.record || grid.hasAttribute("aria-busy") ? -1 : st.order.indexOf(goto ?? -1);
    if (at >= 0) goto = undefined;
    st.cursor = {
      row: Math.min(st.cursor.row, Math.max(0, count - 1)),
      col: Math.min(st.cursor.col, Math.max(0, cols - 1)),
    };
    const why = s.columns.length
      ? st.text || shaping.filters().length
        ? "No row holds that."
        : "No rows."
      : "No rows (this client names no columns for an empty result).";
    // The scroller stays in the page, so the focused grid keeps its focus.
    if (host.firstChild !== scroller) host.replaceChildren(scroller);
    for (const old of host.querySelectorAll(":scope > .empty")) old.remove();
    if (count === 0) host.append(el(doc, "p", { class: "empty" }, why));
    screen.redraw();
    if (at >= 0) moveTo(at, 0, false);
    finder.changed();
  };

  /**
   * Lay the grid out again after a change of rows, sort, filters, columns or mode; `reorder` false
   * keeps the rows' order (only the columns changed, and no typed filter searches them).
   */
  const relayout = (reorder = true) => {
    const s = set();
    if (!scroller.isConnected) host.replaceChildren(scroller);
    const ch = screen.measure();
    if (measured.set !== s || measured.ch !== ch) {
      measured = { set: s, ch, px: defaultWidths(s, ch) };
      st.numeric = numericColumns(s);
    }
    st.layout = layoutOf(s.columns, shape().columns, measured.px);
    if (!reorder && orderedFor === s) return arrange();
    const input = {
      numeric: st.numeric,
      ...shaping.local(),
      text: st.text,
      search: st.layout.visible,
    };
    const id = ++asked;
    const added = changes()?.inserts.map((_, i) => s.rows.length + i) ?? [];
    const got = rows.order(s, changes(), input);
    const before = orderedFor === s ? st.order : [];
    orderedFor = s;
    if (Array.isArray(got)) {
      st.order = [...got, ...added];
      return arrange();
    }
    grid.setAttribute("aria-busy", "true");
    void got.then(
      (kept) => {
        if (id !== asked) return;
        grid.removeAttribute("aria-busy");
        st.order = [...kept, ...added];
        arrange();
      },
      () => grid.removeAttribute("aria-busy"),
    );
    // Until the worker answers, the rows stay in the order they had, or as the result holds them.
    st.order = before.length ? before : [...range(0, s.rows.length), ...added];
    arrange();
  };

  /** Draw a tab: a grid for a result set, a plan, or the messages. */
  const render = (
    /** @type {Tab | null} */ next,
    /** @type {boolean} */ fresh,
    /** @type {Context} */ given,
  ) => {
    if (st.tab?.set && next?.kind === "map") maps.leave(st.tab.set, blockRows(), cursorCell()?.row);
    st.tab = next;
    st.context = given;
    shaping.answered();
    const key = given.key ?? "result:none";
    if (fresh) {
      st.text = "";
      st.cursor = { row: 0, col: 0 };
      st.anchor = st.cursor;
      st.recordAt = 0;
      scroller.scrollTop = 0;
      if (key !== shownKey) scroller.scrollLeft = 0;
    }
    shownKey = key;
    links.shown(next?.set ? key : "");
    if (!next) return host.replaceChildren();
    if (next.kind === "plan" && next.plan) return host.replaceChildren(planView(doc, next, act));
    if (next.kind === "map") return maps.show(host, next);
    if (fresh) goto = maps.take(next.set);
    if (next.kind === "messages" || !next.set) {
      const lines = (next.lines ?? []).map((line) => lineOf(doc, line, act));
      strip.draw([], false);
      return host.replaceChildren(el(doc, "ul", { class: "messages" }, ...lines));
    }
    relayout();
  };

  const shaping = createShaping({
    set,
    layout: () => st.layout,
    shape,
    server: () =>
      st.context.server ? { sort: st.context.sort ?? [], filters: st.context.filters ?? [] } : null,
    column: screen.cursorColumn,
    value: () =>
      st.tab?.set ? cellOf(st.cursor.row, st.record ? 1 : st.cursor.col).value : undefined,
    numeric: (col) => st.numeric[col] ?? false,
    ch: () => st.ch || 7,
    record: () => st.record,
    columns(next, follow) {
      shapes.columnsChanged(shape(), next);
      relayout(st.text !== "");
      const at = st.layout.visible.findIndex((c) => st.layout.keys[c] === follow);
      if (at >= 0) moveTo(st.record ? at : st.cursor.row, st.record ? 1 : at, false);
    },
    rows: () => relayout(),
    act,
  });
  const strip = createStrip(doc, { remove: shaping.removeFilter, clear: shaping.clearFilters });
  const finder = createFinder(doc, {
    search: (query) =>
      st.tab?.set
        ? rows.find(set(), changes(), {
            ...query,
            order: st.order,
            search: st.layout.visible,
            limit: 100_000,
          })
        : { matches: new Int32Array(0), count: 0 },
    cursor: () => st.cursor,
    go(row, col) {
      if (st.record) toggleRecord();
      moveTo(row, col, false);
    },
    focus: () => grid.focus(),
    drawn: () => screen.paint(),
  });
  host.before(finder.el, strip.el);

  const editor = createCellEditor(
    doc,
    grid,
    (editing, value, move) => {
      if (value !== undefined) act("editCell", editing.row, editing.col, value);
      if (move === "down") moveTo(st.cursor.row + 1, st.cursor.col, false);
      else if (move === "right") moveTo(st.cursor.row, st.cursor.col + 1, false);
    },
    () => grid.focus(),
    act,
  );

  const startEdit = () => {
    const cell = cursorCell();
    if (!cell) return;
    if (!cell.editable) return act("value", cell);
    if (links.title(cell.col) !== undefined) return act("pickKey");
    const target = body.querySelector(
      `[aria-rowindex="${st.cursor.row + 2}"] [aria-colindex="${st.cursor.col + 1}"]`,
    );
    if (target) editor.open(/** @type {HTMLElement} */ (target), cell);
  };

  const menu = createCellMenu(doc, doc.body, {
    filter: (op) =>
      op === "contains" ? act("askContains") : say(shaping.filter(/** @type {never} */ (op))),
    column: (action) => keys.run(action),
    closed: () => grid.focus(),
  });
  /** The cell's menu by the cursor's cell, or at a point. */
  const openMenu = (/** @type {{ x: number, y: number } | undefined} */ at = undefined) => {
    const cell = cursorCell();
    if (!cell) return;
    const near = /** @type {HTMLElement} */ (body.querySelector(".cell.cursor") ?? grid);
    menu.open(
      near,
      {
        value: cell.value,
        numeric: st.numeric[cell.col] ?? false,
        pinned: !st.record && st.cursor.col < st.layout.pinned,
        sortable: !st.record,
        hidden: columns().hidden.length,
        editable: !st.record && st.context.edit?.status === "ready",
        link: cell.value !== null && links.title(cell.col) !== undefined,
        referenced: links.referenced(),
      },
      at,
    );
  };

  const toggleRecord = () => {
    if (!st.tab?.set) return st.record;
    if (!st.record) st.recordAt = st.order[st.cursor.row] !== undefined ? st.cursor.row : 0;
    st.record = !st.record;
    st.cursor = { row: 0, col: st.record ? 1 : 0 };
    st.anchor = st.cursor;
    relayout();
    act("recordChanged", st.record);
    return st.record;
  };

  const keys = createGridKeys({
    grid,
    scroller,
    act,
    shaping,
    finder,
    editing: () => editor.active(),
    record: () => st.record,
    column: screen.cursorColumn,
    size,
    cursor: () => st.cursor,
    moveTo,
    records(step) {
      st.recordAt = Math.max(0, Math.min(st.order.length - 1, st.recordAt + step));
      relayout();
    },
    startEdit,
    cursorCell,
    blockRows,
    addRows(action) {
      st.toEnd = true;
      act(action);
    },
    toggleRecord,
    openMenu,
    say,
    selected() {
      const b = screen.block();
      return !st.record && (b.bottom > b.top || b.right > b.left);
    },
  });
  const pasting = createGridPaste(doc, {
    grid,
    st,
    block: screen.block,
    editing: () => editor.active(),
    act,
    ...(options.startWorker ? { startWorker: options.startWorker } : {}),
  });

  /** The columns on screen: their keys, the hidden ones, how many are pinned, their widths. */
  const columns = () => ({
    keys: st.layout.visible.map((c) => st.layout.keys[c] ?? ""),
    hidden: shape().columns.hidden.filter((k) => st.layout.keys.includes(k)),
    pinned: st.layout.pinned,
    widths: [...st.layout.widths],
  });

  scroller.addEventListener("scroll", screen.paint);
  attachHeader(doc, head, grid, {
    width: shaping.width,
    resize: (col, px) => shaping.resize(col, px),
    fit: (col) => shaping.fit(col),
    drop: (col, index) => shaping.drop(col, index),
  });
  attachPointer(doc, screen, {
    record: () => st.record,
    editing: () => editor.active(),
    sortBy: shaping.sortBy,
    startEdit,
    openMenu,
    selection,
    cursorRow: () => st.cursor.row,
    follow: () => act("followKey"),
  });

  return {
    render,
    focus: () => grid.focus(),
    selection,
    cursorCell,
    toggleRecord,
    recording: () => st.record,
    /** Keep the rows holding `text` on screen. */
    filter(/** @type {string} */ typed) {
      st.text = typed;
      st.cursor = { row: 0, col: st.cursor.col };
      st.anchor = st.cursor;
      if (st.tab?.set) relayout();
    },
    columns,
    /** An operation by name, as a command runs it (features/grid/); undefined without a result. */
    command(/** @type {string} */ op, /** @type {Record<string, unknown>} */ args = {}) {
      if (!st.tab?.set) return undefined;
      if (op === "columns") return columns();
      return pasting.command(op, args) ?? keys.command(op, args);
    },
  };
}
