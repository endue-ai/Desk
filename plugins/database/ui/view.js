// The DOM of the Database surface: the header (the connection on screen, its environment tag and
// read-only mark, the buttons), the explorer and its filter on the left, the console (a highlighted
// editor with autocomplete, a table's filter and pages, or an object's DDL) over the results on
// the right, the result's toolbar (row filter, record view, value viewer, pages, pending changes),
// the dialogs (connection, password, value, the changes' SQL), and a hint line and a status live
// region at the bottom. Mod chords other than the surface's own are never prevented, so the desk's
// keymap gets them.

import { el } from "./dom.js";
import { engineOf } from "./engines/index.js";
import { formatCount } from "./format.js";
import { hints } from "./keys.js";
import { diagramView } from "./view-diagram.js";
import { createEditor } from "./view-editor.js";
import { createForms } from "./view-form.js";
import { createGrid } from "./view-grid.js";
import { createImportView } from "./view-import.js";
import { createTree } from "./view-tree.js";
import { createValueViewer } from "./view-value.js";

/**
 * @typedef {import("./database.js").View} View
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const ENGINE = { postgresql: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 * @returns {View}
 */
export function createView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));
  const editorEl = /** @type {HTMLTextAreaElement} */ (byId("editor"));
  const editorBox = byId("editor-box");
  const tableBar = /** @type {HTMLFormElement} */ (byId("table-bar"));
  const [where, order, filter, quick] = ["where", "order", "filter", "quick"].map(input);
  const statusEl = byId("status");
  const tabsEl = byId("tabs");
  const gridBar = byId("grid-bar");
  const record = byId("record");
  const previewForm = /** @type {HTMLFormElement} */ (byId("preview"));
  const say = (/** @type {string} */ text) => {
    statusEl.textContent = text;
  };
  /** @type {Console | null} */
  let shown = null;
  /** What the grid drew last, so a redraw of the same run keeps its sort and cursor. */
  let drawn = "";
  /** The diagram on screen, drawn again only when its layout is another. */
  /** @type {unknown} */
  let drawnLayout = null;
  /** The results whose editability was asked for, so it is asked once. */
  let asked = "";

  const tree = createTree(doc, byId("tree"), (action, ...args) =>
    action === "filter" ? filter.focus() : act(action, ...args),
  );
  const copyText = (/** @type {string} */ text) => {
    const scratch = el(doc, "textarea", { class: "offscreen", "aria-hidden": "true" });
    scratch.textContent = text;
    doc.body.append(scratch);
    /** @type {HTMLTextAreaElement} */ (scratch).select();
    let done = false;
    try {
      done = doc.execCommand("copy");
    } catch {
      done = false;
    }
    scratch.remove();
    return done;
  };
  const grid = createGrid(doc, byId("result"), (action, ...args) => {
    if (action === "say") say(String(args[0]));
    else if (action === "editor") editorEl.focus();
    else if (action === "previousTab" || action === "nextTab")
      act("tab", (shown?.tab ?? 0) + (action === "nextTab" ? 1 : -1));
    else if (action === "value") values.open(/** @type {never} */ (args[0]));
    else if (action === "quick") quick.focus();
    else if (action === "sort") act("page", { sort: args[0] });
    else if (action === "recordChanged") record.setAttribute("aria-pressed", String(args[0]));
    else return act(action, ...args);
    return undefined;
  });
  const values = createValueViewer(doc, act, copyText, () => grid.focus());
  const editor = createEditor(
    doc,
    { box: editorBox, editor: editorEl, layer: byId("highlight"), list: byId("complete") },
    (action, ...args) => (action === "say" ? say(String(args[0])) : act(action, ...args)),
    () => shown?.running ?? false,
  );
  const forms = createForms(doc, act);
  const imports = createImportView(doc, act);

  for (const button of doc.querySelectorAll("[data-act]"))
    button.addEventListener("click", () =>
      act(/** @type {HTMLElement} */ (button).dataset.act ?? ""),
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
  byId("value-open").addEventListener("click", () => values.open(grid.cursorCell()));
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

  /** The header: the connection, its engine and place, its environment and read-only marks. */
  const header = (/** @type {Console | null} */ model, /** @type {Connection | null} */ conn) => {
    const title = byId("title");
    const badge = byId("badge");
    title.textContent = conn
      ? model && model.kind !== "console"
        ? model.name.replace(/^(?:db|ddl|er): /u, "")
        : conn.name
      : "Database";
    title.title = conn
      ? `${ENGINE[conn.engine]} · ${conn.engine === "sqlite" ? conn.file : conn.host}`
      : "";
    const tag = conn && conn.tag !== "none" ? conn.tag : "";
    badge.hidden = !tag && !conn?.readOnly;
    badge.textContent = [tag, conn?.readOnly ? "read-only" : ""].filter(Boolean).join(" · ");
    badge.className = tag ? `tag tag-${tag}` : "tag";
    doc.body.dataset.tag = tag;
    doc.body.dataset.color = conn?.color ?? "";
    doc.body.dataset.running = String(model?.running ?? false);
  };

  /** The result's toolbar: what can be done with the rows on screen, and their pending changes. */
  const toolbar = (/** @type {Console} */ model) => {
    const tab = model.shown?.tabs[model.tab];
    gridBar.hidden = !tab?.set;
    const edit = model.edit;
    const ready = edit?.status === "ready";
    /** @type {HTMLElement} */ for (const node of gridBar.querySelectorAll(".edit-only"))
      node.hidden = !ready;
    byId("changes").hidden = !edit?.count;
    byId("changes-count").textContent = edit?.count
      ? `${formatCount(edit.count)} pending change${edit.count === 1 ? "" : "s"}`
      : "";
    byId("edit-note").textContent = edit?.message ?? "";
    const pages = byId("console-pages");
    pages.hidden = !(model.kind === "console" && model.page);
    if (model.page) {
      const rows = tab?.set?.rows.length ?? 0;
      byId("console-page").textContent =
        `${formatCount(model.page.offset + 1)}–${formatCount(model.page.offset + rows)}`;
    }
  };

  /** The work area for a console, a table's view or a DDL view. */
  const draw = (/** @type {Console | null} */ model, /** @type {Connection | null} */ conn) => {
    const previous = shown;
    shown = model;
    byId("empty").hidden = model !== null;
    byId("actions").hidden = model === null;
    editorBox.hidden = model?.kind !== "console" && model?.kind !== "ddl";
    tableBar.hidden = model?.kind !== "table";
    byId("results").hidden = !model?.shown;
    const diagramBox = byId("diagram-box");
    diagramBox.hidden = model?.kind !== "diagram";
    if (model?.kind === "diagram" && model.diagram && model.diagram.layout !== drawnLayout) {
      const { schema, layout } = model.diagram;
      drawnLayout = layout;
      diagramBox.replaceChildren(
        diagramView(doc, layout, (table) => act("openTable", model.connection, schema, table)),
      );
    }
    header(model, conn);
    // Another console's text, or this one's changed from outside (history); never under the person's typing.
    const typing = doc.activeElement === editorEl && previous?.id === model?.id;
    if (model && conn && (model.kind === "console" || model.kind === "ddl") && !typing)
      editor.show(model.text, engineOf(conn.engine).dialect, model.kind === "ddl");
    if (model?.kind === "table" && model.table) {
      if (doc.activeElement !== where) where.value = model.table.where;
      if (doc.activeElement !== order) order.value = model.table.order;
      const rows = model.shown?.tabs[0]?.set?.rows.length ?? 0;
      const from = rows ? model.table.offset + 1 : 0;
      const count = model.table.count === null ? "" : ` of ${formatCount(model.table.count)}`;
      byId("page").textContent =
        `${formatCount(from)}–${formatCount(model.table.offset + rows)}${count}`;
    }
    byId("summary").textContent = model?.running ? "Running…" : (model?.shown?.summary ?? "");
    if (!model?.shown) {
      tabsEl.replaceChildren();
      gridBar.hidden = true;
      grid.render(null, true, { edit: null, server: false });
      drawn = "";
      return;
    }
    tabsEl.replaceChildren(
      ...model.shown.tabs.map((tab, index) =>
        el(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": String(index === model.tab),
            class: `desk-tab tab-${tab.kind}`,
            "data-index": String(index),
          },
          tab.label,
        ),
      ),
    );
    toolbar(model);
    const key = `${model.id}:${model.execution?.at ?? 0}:${model.tab}`;
    const fresh = key !== drawn;
    if (fresh && quick.value) quick.value = "";
    grid.render(model.shown.tabs[model.tab] ?? null, fresh, {
      edit: model.edit,
      server: model.kind === "table",
      ordered: Boolean(model.table?.order),
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
    explorer: (rows) => tree.render(rows),
    console: draw,
    form: forms.form,
    password: forms.password,
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
    copy: copyText,
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
  };
}
