// The DOM of the Database surface: the header (the connection on screen, its environment tag and
// read-only mark, the buttons), the explorer and its filter on the left, the console (a highlighted
// editor with autocomplete, a table's filter and pages, an object's DDL, or a feature's panel) over
// the results on the right, the result's toolbar (row filter, record view, value viewer, pages,
// pending changes), the dialogs (connection, password, value, the changes' SQL, the features'), and a hint line
// and a status live region at the bottom. Mod chords other than the surface's own are never
// prevented, so the desk's keymap gets them.

import { copyText } from "./clipboard.js";
import { engineOf } from "./engines/index.js";
import { dialogsOf, panelsOf } from "./feature-host.js";
import * as all from "./features/index.js";
import { formatCount } from "./format.js";
import { hints } from "./keys.js";
import { createActions } from "./view-actions.js";
import { createBars } from "./view-bars.js";
import { createDialogs } from "./view-dialog.js";
import { createEditor } from "./view-editor.js";
import { createForms } from "./view-form.js";
import { createGrid } from "./view-grid.js";
import { createImportView } from "./view-import.js";
import { createPanelBox, linkStyles } from "./view-panel.js";
import { createTree } from "./view-tree.js";
import { createValueViewer } from "./view-value.js";

/**
 * @typedef {import("./database.js").View} View
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 * @param {import("./feature-host.js").Feature[]} [features] features/index.js's unless given.
 * @param {{ startWorker?: import("./grid/rows-client.js").StartWorker }} [options] The SDK's
 *   worker starter, for the grid's large results (main.js); without it they are ordered here.
 * @returns {View}
 */
export function createView(doc, act, features = Object.values(all), options = {}) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));
  const editorEl = /** @type {HTMLTextAreaElement} */ (byId("editor"));
  const editorBox = byId("editor-box");
  const tableBar = /** @type {HTMLFormElement} */ (byId("table-bar"));
  const [where, order, filter, quick] = ["where", "order", "filter", "quick"].map(input);
  const statusEl = byId("status");
  const tabsEl = byId("tabs");
  const record = byId("record");
  const previewForm = /** @type {HTMLFormElement} */ (byId("preview"));
  // The footer keeps to one line, so a long message is cut there; its title holds all of it.
  const say = (/** @type {string} */ text) => {
    statusEl.textContent = text;
    statusEl.title = text;
  };
  /** @type {Console | null} */
  let shown = null;
  /** What the grid drew last, so a redraw of the same run keeps its sort and cursor. */
  let drawn = "";
  /** The results whose editability was asked for, so it is asked once. */
  let asked = "";

  // With nothing open the work pane names the connection the explorer's cursor is in.
  const empty = byId("empty");
  const pick = empty.textContent ?? "";
  const tree = createTree(
    doc,
    byId("tree"),
    (action, ...args) => (action === "filter" ? filter.focus() : act(action, ...args)),
    (row) => {
      empty.textContent = row
        ? `No console is open on ${row.label}: Enter or a double click on it opens one.`
        : pick;
    },
  );
  const copy = (/** @type {string} */ text) => copyText(doc, text);
  const grid = createGrid(
    doc,
    byId("result"),
    (action, ...args) => {
      if (action === "say") say(String(args[0]));
      else if (action === "editor") editorEl.focus();
      else if (action === "previousTab" || action === "nextTab")
        act("tab", (shown?.tab ?? 0) + (action === "nextTab" ? 1 : -1));
      else if (action === "value") openValue(/** @type {never} */ (args[0]));
      else if (action === "showSet")
        act("tab", shown?.shown?.tabs.findIndex((t) => t.set === args[0]) ?? -1);
      else if (action === "quick") quick.focus();
      else if (action === "sort") act("page", { sort: args[0] });
      else if (action === "filters") act("page", { filters: args[0] });
      else if (action === "recordChanged") record.setAttribute("aria-pressed", String(args[0]));
      else return act(action, ...args);
      return undefined;
    },
    options,
  );
  const values = createValueViewer(doc, act, copy, () => grid.focus(), options.startWorker);
  /** The value viewer on a cell, with its column's type OID (a built-in geometric type's shape). */
  const openValue = (/** @type {ReturnType<typeof grid.cursorCell>} */ cell) =>
    values.open(cell && { ...cell, oid: shown?.shown?.tabs[shown.tab]?.set?.types?.[cell.col] });
  const editor = createEditor(
    doc,
    { box: editorBox, editor: editorEl, layer: byId("highlight"), list: byId("complete") },
    (action, ...args) => (action === "say" ? say(String(args[0])) : act(action, ...args)),
    () => shown?.running ?? false,
  );
  const forms = createForms(doc, act);
  const imports = createImportView(doc, act);
  const bars = createBars(doc);
  const panels = createPanelBox(doc, byId("panel-box"), panelsOf(features), act);
  linkStyles(doc, features);
  const dialogs = createDialogs(doc, doc.querySelector("main") ?? doc.body, dialogsOf(features));

  for (const button of doc.querySelectorAll("[data-act]"))
    button.addEventListener("click", () =>
      act(/** @type {HTMLElement} */ (button).dataset.act ?? ""),
    );
  createActions(
    doc,
    { nav: byId("actions"), more: byId("actions-more"), menu: byId("actions-menu") },
    act,
  );
  // Reading a large output in the result worker shows a bar after 300 ms, with Cancel (#38).
  byId("reading")?.addEventListener("desk-cancel", () => act("cancel"));
  for (const button of doc.querySelectorAll("[data-page]"))
    button.addEventListener("click", () =>
      act("page", { delta: Number(/** @type {HTMLElement} */ (button).dataset.page) }),
    );
  for (const button of doc.querySelectorAll("[data-console-page]"))
    button.addEventListener("click", () =>
      act("page", { delta: Number(/** @type {HTMLElement} */ (button).dataset.consolePage) }),
    );
  byId("count").addEventListener("click", () => act("page", { count: true }));
  tableBar.addEventListener("submit", (event) => {
    event.preventDefault();
    act("page", { where: where.value, order: order.value });
  });
  filter.addEventListener("input", () => act("filter", filter.value));
  filter.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      if (event.key === "Escape" && filter.value) {
        filter.value = "";
        act("filter", "");
      }
      tree.focus();
    }
  });
  quick.addEventListener("input", () => grid.filter(quick.value));
  quick.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      if (event.key === "Escape" && quick.value) {
        quick.value = "";
        grid.filter("");
      }
      grid.focus();
    }
  });
  record.addEventListener("click", () => grid.toggleRecord());
  byId("value-open").addEventListener("click", () => openValue(grid.cursorCell()));
  previewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    previewForm.hidden = true;
    act("submitChanges");
  });
  const closePreview = () => {
    previewForm.hidden = true;
    grid.focus();
  };
  byId("preview-close").addEventListener("click", closePreview);
  previewForm.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePreview();
    }
  });
  for (const [area, node] of /** @type {const} */ ([
    ["explorer", byId("tree")],
    ["editor", editorEl],
    ["grid", byId("result")],
  ]))
    node.addEventListener("focusin", () => {
      byId("hints").textContent = hints(area);
    });
  tabsEl.addEventListener("click", (event) => {
    const tab = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest("[role=tab]")
    );
    const index = Number(tab?.dataset.index);
    if (!Number.isNaN(index)) act("tab", index);
  });

  /** The work area for a console, a table's view, a DDL view or a feature's panel. */
  const draw = (/** @type {Console | null} */ model, /** @type {Connection | null} */ conn) => {
    const previous = shown;
    shown = model;
    empty.hidden = model !== null;
    byId("actions").hidden = model === null;
    editorBox.hidden = model?.kind !== "console" && model?.kind !== "ddl";
    tableBar.hidden = model?.kind !== "table";
    byId("results").hidden = !model?.shown;
    panels.draw(model);
    bars.header(model, conn);
    // Another console's text, or this one's changed from outside (history); never under the person's typing.
    const typing = doc.activeElement === editorEl && previous?.id === model?.id;
    if (model && conn && (model.kind === "console" || model.kind === "ddl") && !typing)
      editor.show(model.text, engineOf(conn.engine).dialect, model.kind === "ddl", model.id);
    if (model?.kind === "console" && model.execution) editor.ran(model.execution);
    if (model?.kind === "table" && model.table) {
      if (doc.activeElement !== where) where.value = model.table.where;
      if (doc.activeElement !== order) order.value = model.table.order;
      const rows = model.shown?.tabs[0]?.set?.rows.length ?? 0;
      const from = rows ? model.table.offset + 1 : 0;
      const count = model.table.count === null ? "" : ` of ${formatCount(model.table.count)}`;
      byId("page").textContent =
        `${formatCount(from)}–${formatCount(model.table.offset + rows)}${count}`;
    }
    const summary = byId("summary");
    summary.textContent = model?.running ? "Running…" : (model?.shown?.summary ?? "");
    summary.title = summary.textContent;
    if (!model?.shown) {
      bars.tabs(null);
      bars.toolbar(null);
      grid.render(null, true, { edit: null, server: false });
      drawn = "";
      return;
    }
    bars.tabs(model);
    bars.toolbar(model);
    const key = `${model.id}:${model.execution?.at ?? 0}:${model.tab}`;
    const fresh = key !== drawn;
    if (fresh && quick.value) quick.value = "";
    const page = model.kind === "table" ? model.table : null;
    grid.render(model.shown.tabs[model.tab] ?? null, fresh, {
      edit: model.edit,
      server: Boolean(page),
      ordered: Boolean(page?.order),
      // A table view's columns are the table's (kept across restarts), a result's its own.
      key: page ? `table:${model.connection}:${page.schema}.${page.name}` : `result:${key}`,
      sort: page?.sort ?? [],
      filters: page?.filters ?? [],
    });
    drawn = key;
    if (fresh) record.setAttribute("aria-pressed", String(grid.recording()));
    const tab = model.shown.tabs[model.tab];
    if (tab?.set && !model.edit && asked !== key && model.kind !== "ddl" && !model.running) {
      asked = key;
      act("canEdit");
    }
  };

  return {
    explorer: (rows) => {
      tree.render(rows);
      editor.recheck();
    },
    console: draw,
    closed: (id) => panels.closed(id),
    form: forms.form,
    password: forms.password,
    dialog: (type, model) => dialogs.show(type, model),
    say,
    busy(running) {
      byId("busy").hidden = running === 0;
    },
    reading(reads) {
      const bar = byId("reading");
      if (bar) bar.hidden = reads === 0;
    },
    editor: () => ({
      text: editorEl.value,
      start: editorEl.selectionStart,
      end: editorEl.selectionEnd,
    }),
    select(start, end) {
      editorEl.focus();
      editorEl.setSelectionRange(start, end);
    },
    replace: (start, end, text) => editor.replace(start, end, text),
    insert(text) {
      const at = editorEl.selectionEnd;
      const before = editorEl.value.slice(0, at);
      const glue = before === "" || before.endsWith("\n") ? "" : "\n";
      editorEl.setRangeText(`${glue}${text}`, at, at, "end");
      editorEl.focus();
      editor.repaint();
      act("edited", editorEl.value);
    },
    copy,
    preview(sql) {
      byId("preview-sql").textContent = sql;
      previewForm.hidden = false;
      byId("preview-sql").focus();
    },
    importer: (model) => imports.render(model),
    /** The explorer's row an element is in, for what it drags (view-dnd.js). */
    nodeAt: (/** @type {unknown} */ target) => tree.nodeAt(target),
    focus(where_) {
      if (where_ === "explorer") tree.focus();
      else if (where_ === "grid") grid.focus();
      else if (!editorBox.hidden) editorEl.focus();
    },
    selection: () => {
      const picked = grid.selection();
      return picked ? { tab: shown?.tab ?? 0, ...picked } : undefined;
    },
    /** An operation of the grid on screen by name, for the grid's commands (features/grid/). */
    grid: (op, args) => grid.command(op, args),
    cell: () => grid.cursorCell(),
    /** The SQL problems of the console on screen: list them, or go to the next or previous. */
    problems: (/** @type {"list" | "next" | "previous"} */ what) => editor.problems(what),
    /** The signature help and `*` written out in the console on screen (features/completion/). */
    signatures: () => editor.signatures(),
    expandStar: () => editor.expandStar(),
  };
}
