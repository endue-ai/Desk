// The bars around the work area: the header (the console or the buffer on screen, a .sql file's
// unsaved mark, its engine and place, its environment and read-only marks, the state of its
// PostgreSQL session in words and a status dot, PG-02, and the database a console or a table view
// is on, a button to switch it, PG-13, with the role and search path its sessions start with, PG-12;
// a console's transaction beside it, PG-20) and the result's bars (its tabs, and the toolbar of what can
// be done with the rows on screen and their pending changes; on a console's Notifications tab, its
// note and buttons, PG-25).

import { labelOf } from "./console-list.js";
import { ownDatabase } from "./databases.js";
import { el } from "./dom.js";
import { headerOf } from "./engines/pg-options.js";
import { formatCount } from "./format.js";
import { createTransactionHeader } from "./session/header-view.js";

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
  const transaction = createTransactionHeader(doc);

  /** A console's or a table view's PostgreSQL session: its state, the sentence under it. */
  const session = (/** @type {Console["session"]} */ model) => {
    const shown = byId("session");
    shown.hidden = !model;
    if (!model) return transaction(undefined);
    shown.title = model.detail;
    byId("session-label").textContent = model.label;
    const dot = /** @type {HTMLElement} */ (shown.querySelector(".desk-dot"));
    if (model.tone) dot.dataset.tone = model.tone;
    else delete dot.dataset.tone;
    transaction(model);
  };

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
      // The role and the search path its sessions start with (PG-12).
      const options = byId("session-options");
      options.textContent = on ? headerOf(conn) : "";
      options.hidden = !options.textContent;
      const tag = conn && conn.tag !== "none" ? conn.tag : "";
      badge.hidden = !tag && !conn?.readOnly;
      badge.textContent = [tag, conn?.readOnly ? "read-only" : ""].filter(Boolean).join(" · ");
      badge.className = tag ? `tag tag-${tag}` : "tag";
      doc.body.dataset.tag = tag;
      doc.body.dataset.color = conn?.color ?? "";
      doc.body.dataset.running = String(Boolean(model?.running || model?.filing));
      session(model?.session);
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
              title: tab.pin
                ? `Pinned: ${tab.pin.sql.replace(/\s+/gu, " ").slice(0, 200)}`
                : undefined,
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
      byId("edit-note").textContent =
        tab?.kind === "notifications" ? (tab.note ?? "") : (edit?.message ?? "");
      byId("notifications-bar").hidden = tab?.kind !== "notifications";
      byId("listen-again").hidden = !tab?.stopped;
      // A console's result pins (features/compare/); a pinned one unpins.
      const pin = byId("pin");
      pin.hidden = model.kind !== "console";
      pin.textContent = tab?.kind === "pinned" ? "Unpin" : "Pin";
      const pages = byId("console-pages");
      // A read its cursor keeps scrolls instead of paging (PG-22).
      pages.hidden = !(model.kind === "console" && model.page && !tab?.set?.window);
      if (model.page) {
        const rows = tab?.set?.rows.length ?? 0;
        byId("console-page").textContent =
          `${formatCount(model.page.offset + 1)}–${formatCount(model.page.offset + rows)}`;
      }
    },
  };
}
