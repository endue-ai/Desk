// The bars around the work area: the header (the console or the buffer on screen, a .sql file's
// unsaved mark, its engine and place, its environment and read-only marks, and the PostgreSQL
// database a console or a table view is on, a button to switch it) and the result's bars (its
// tabs, and the toolbar of what can be done with the rows on screen and their pending changes).

import { labelOf } from "./console-list.js";
import { ownDatabase } from "./databases.js";
import { el } from "./dom.js";
import { formatCount } from "./format.js";

/**
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./engines/common.js").Connection} Connection
 */

const ENGINE = { postgresql: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };

/** @param {Document} doc */
export function createBars(doc) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const gridBar = byId("grid-bar");
  const tabsEl = byId("tabs");

  return {
    /** The header: a console by what it is called (`Shop 2`, `● report.sql · Shop`), another
     * buffer by its name after its kind. */
    header(/** @type {Console | null} */ model, /** @type {Connection | null} */ conn) {
      const title = byId("title");
      const badge = byId("badge");
      title.textContent =
        model?.kind === "console"
          ? `${model.file?.modified ? "● " : ""}${labelOf(model, conn)}`
          : conn
            ? model
              ? model.name.replace(/^[\w-]+: /u, "")
              : conn.name
            : "Database";
      title.title = conn
        ? `${ENGINE[conn.engine]} · ${conn.engine === "sqlite" ? conn.file : conn.host}`
        : "";
      const database = byId("database");
      const on =
        conn?.engine === "postgresql" && (model?.kind === "console" || model?.kind === "table");
      database.hidden = !on;
      database.textContent = on ? ownDatabase(conn) : "";
      const tag = conn && conn.tag !== "none" ? conn.tag : "";
      badge.hidden = !tag && !conn?.readOnly;
      badge.textContent = [tag, conn?.readOnly ? "read-only" : ""].filter(Boolean).join(" · ");
      badge.className = tag ? `tag tag-${tag}` : "tag";
      doc.body.dataset.tag = tag;
      doc.body.dataset.color = conn?.color ?? "";
      doc.body.dataset.running = String(Boolean(model?.running || model?.filing));
    },

    /** The result's tabs, the one on screen selected. */
    tabs(/** @type {Console | null} */ model) {
      tabsEl.replaceChildren(
        ...(model?.shown?.tabs ?? []).map((tab, index) =>
          el(
            doc,
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": String(index === model?.tab),
              class: `desk-tab tab-${tab.kind}`,
              "data-index": String(index),
            },
            tab.label,
          ),
        ),
      );
    },

    /** The result's toolbar: what can be done with the rows on screen, and their pending changes. */
    toolbar(/** @type {Console | null} */ model) {
      const tab = model?.shown?.tabs[model.tab];
      gridBar.hidden = !tab?.set;
      if (!model) return;
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
    },
  };
}
