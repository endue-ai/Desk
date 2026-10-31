// The DOM of the Database surface: the header (the connection on screen, its environment tag and
// read-only mark, the buttons), the explorer on the left, the console (an editor, or a table's
// filter and pages) over the results on the right, the connection form and the password prompt,
// and a hint line and a status live region at the bottom. Mod chords other than the editor's two
// are never prevented, so the desk's keymap gets them.

import { el } from "./dom.js";
import { actionFor, hints, pressOf } from "./keys.js";
import { createForms } from "./view-form.js";
import { createGrid } from "./view-grid.js";
import { createTree } from "./view-tree.js";

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
  const titleEl = byId("title");
  const badge = byId("badge");
  const busyEl = byId("busy");
  const empty = byId("empty");
  const editor = /** @type {HTMLTextAreaElement} */ (byId("editor"));
  const tableBar = /** @type {HTMLFormElement} */ (byId("table-bar"));
  const where = /** @type {HTMLInputElement} */ (byId("where"));
  const order = /** @type {HTMLInputElement} */ (byId("order"));
  const pageEl = byId("page");
  const results = byId("results");
  const actions = byId("actions");
  const tabsEl = byId("tabs");
  const hintsEl = byId("hints");
  const summaryEl = byId("summary");
  const statusEl = byId("status");
  const tree = createTree(doc, byId("tree"), act);
  const grid = createGrid(doc, byId("result"), (action, ...args) => {
    if (action === "say") statusEl.textContent = String(args[0]);
    else if (action === "editor") editor.focus();
    else if (action === "previousTab" || action === "nextTab")
      act("tab", (shown?.tab ?? 0) + (action === "nextTab" ? 1 : -1));
    else act(action, ...args);
  });
  const forms = createForms(doc, act);
  /** @type {Console | null} */
  let shown = null;
  /** What the grid drew last, so a redraw of the same run keeps its sort and cursor. */
  let drawn = "";

  for (const button of doc.querySelectorAll("[data-act]")) {
    button.addEventListener("click", () =>
      act(/** @type {HTMLElement} */ (button).dataset.act ?? ""),
    );
  }
  for (const button of doc.querySelectorAll("[data-page]")) {
    button.addEventListener("click", () =>
      act("page", { delta: Number(/** @type {HTMLElement} */ (button).dataset.page) }),
    );
  }
  byId("count").addEventListener("click", () => act("page", { count: true }));
  tableBar.addEventListener("submit", (event) => {
    event.preventDefault();
    act("page", { where: where.value, order: order.value });
  });

  editor.addEventListener("keydown", (event) => {
    const action = actionFor("editor", pressOf(event), { running: shown?.running ?? false });
    if (!action) return;
    event.preventDefault();
    act(action);
  });
  editor.addEventListener("input", () => act("edited", editor.value));
  for (const [area, node] of /** @type {const} */ ([
    ["explorer", byId("tree")],
    ["editor", editor],
    ["grid", byId("result")],
  ])) {
    node.addEventListener("focusin", () => {
      hintsEl.textContent = hints(area);
    });
  }
  tabsEl.addEventListener("click", (event) => {
    const index = Number(
      /** @type {HTMLElement | null} */ (
        /** @type {HTMLElement} */ (event.target).closest("[role=tab]")
      )?.dataset.index,
    );
    if (!Number.isNaN(index)) act("tab", index);
  });

  /** The work area for a console or a table's view. */
  const draw = (/** @type {Console | null} */ model, /** @type {Connection | null} */ conn) => {
    const previous = shown;
    shown = model;
    empty.hidden = model !== null;
    actions.hidden = model === null;
    editor.hidden = model?.kind !== "console";
    tableBar.hidden = model?.kind !== "table";
    results.hidden = !model?.shown;
    titleEl.textContent = conn
      ? model?.kind === "table"
        ? model.name.replace(/^db: /u, "")
        : conn.name
      : "Database";
    titleEl.title = conn
      ? `${ENGINE[conn.engine]}${conn.engine === "sqlite" ? ` · ${conn.file}` : ` · ${conn.host}`}`
      : "";
    const tag = conn && conn.tag !== "none" ? conn.tag : "";
    badge.hidden = !tag && !conn?.readOnly;
    badge.textContent = [tag, conn?.readOnly ? "read-only" : ""].filter(Boolean).join(" · ");
    badge.className = tag ? `tag tag-${tag}` : "tag";
    doc.body.dataset.tag = tag;
    doc.body.dataset.running = String(model?.running ?? false);
    // Another console's text, or this one's changed from outside (history); never under the person's typing.
    const typing = doc.activeElement === editor && previous?.id === model?.id;
    if (model?.kind === "console" && !typing && editor.value !== model.text)
      editor.value = model.text;
    if (model?.kind === "table" && model.table) {
      if (doc.activeElement !== where) where.value = model.table.where;
      if (doc.activeElement !== order) order.value = model.table.order;
      const rows = model.shown?.tabs[0]?.set?.rows.length ?? 0;
      const from = rows ? model.table.offset + 1 : 0;
      const count = model.table.count === null ? "" : ` of ${model.table.count}`;
      pageEl.textContent = `${from}–${model.table.offset + rows}${count}`;
    }
    summaryEl.textContent = model?.running ? "Running…" : (model?.shown?.summary ?? "");
    if (!model?.shown) {
      tabsEl.replaceChildren();
      grid.render(null, true);
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
            class: `tab-${tab.kind}`,
            "data-index": String(index),
          },
          tab.label,
        ),
      ),
    );
    const key = `${model.id}:${model.execution?.at ?? 0}:${model.tab}`;
    grid.render(model.shown.tabs[model.tab] ?? null, key !== drawn);
    drawn = key;
  };

  return {
    explorer: (rows) => tree.render(rows),
    console: draw,
    form: forms.form,
    password: forms.password,
    say(text) {
      statusEl.textContent = text;
    },
    busy(running) {
      busyEl.hidden = running === 0;
    },
    editor: () => ({ text: editor.value, start: editor.selectionStart, end: editor.selectionEnd }),
    select(start, end) {
      editor.focus();
      editor.setSelectionRange(start, end);
    },
    insert(text) {
      const at = editor.selectionEnd;
      const before = editor.value.slice(0, at);
      const glue = before === "" || before.endsWith("\n") ? "" : "\n";
      editor.setRangeText(`${glue}${text}`, at, at, "end");
      editor.focus();
      act("edited", editor.value);
    },
    copy(text) {
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
    },
    focus(where) {
      if (where === "explorer") tree.focus();
      else if (where === "grid") grid.focus();
      else if (!editor.hidden) editor.focus();
    },
    selection: () => {
      const picked = grid.selection();
      return picked ? { tab: shown?.tab ?? 0, ...picked } : undefined;
    },
  };
}
