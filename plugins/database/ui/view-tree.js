// The explorer's DOM: the controller's flat rows as a tree (role=tree, aria-level, aria-expanded),
// a cursor the arrow keys move and that stays on its row across a redraw, Right and Left to open
// and close (or go to the parent), Enter to open a console, a table or an object's DDL, single keys
// for the rest (d the DDL, c the row counts, g a refresh of the row's schema or table, m the
// maintenance form, x a function's or procedure's form, f the value search, o, the context-menu key
// and a right click the row's menu of what can be done to it, p its privileges).

import { el } from "./dom.js";
import { actionFor, pressOf } from "./keys.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const MOVES = new Set(["next", "previous", "first", "last"]);
/** Actions that take the row under the cursor (the objects feature's too). */
const ROWS = new Set([
  "ddl",
  "count",
  "diagram",
  "maintain",
  "routine",
  "searchData",
  "objectMenu",
  "renameObject",
  "editSource",
  "privileges",
]);

/**
 * @param {Document} doc
 * @param {HTMLElement} tree
 * @param {Act} act
 * @param {(connection: Node | undefined) => void} [moved] Told the connection row the cursor is in
 *   each time the cursor or the rows change.
 */
export function createTree(doc, tree, act, moved = () => {}) {
  /** @type {Node[]} */
  let rows = [];
  /** @type {HTMLElement[]} */
  let els = [];
  let cursor = 0;
  let cursorKey = "";

  /** The connection row the cursor is in. */
  const connectionRow = () => {
    const id = rows[cursor]?.connection;
    return id ? rows.find((row) => row.kind === "connection" && row.connection === id) : undefined;
  };

  const render = (/** @type {Node[]} */ next) => {
    rows = next;
    const found = rows.findIndex((row) => row.key === cursorKey);
    cursor = found >= 0 ? found : Math.min(cursor, Math.max(0, rows.length - 1));
    const hadFocus = tree.contains(doc.activeElement);
    els = rows.map((row, index) => {
      const caret = row.expandable
        ? el(doc, "span", { class: "caret", "aria-hidden": "true" }, row.expanded ? "▾" : "▸")
        : el(doc, "span", { class: "caret" });
      const swatch = row.color
        ? el(doc, "span", { class: `swatch swatch-${row.color}`, "aria-hidden": "true" })
        : undefined;
      const tag =
        row.tag && row.tag !== "none"
          ? el(doc, "span", { class: `tag tag-${row.tag}` }, row.tag)
          : undefined;
      const node = el(
        doc,
        "div",
        {
          class: `row ${row.kind}${row.error ? " error" : ""}`,
          role: "treeitem",
          "aria-level": String(row.level),
          "aria-selected": String(index === cursor),
          ...(row.expandable ? { "aria-expanded": String(row.expanded) } : {}),
          "data-index": String(index),
          style: `padding-left: ${(row.level - 1) * 14 + 6}px`,
        },
        caret,
        swatch,
        el(doc, "span", { class: "label" }, row.label),
        tag,
        row.detail ? el(doc, "span", { class: "detail" }, row.detail) : undefined,
      );
      node.tabIndex = index === cursor ? 0 : -1;
      return node;
    });
    tree.replaceChildren(...els);
    if (rows.length === 0) tree.append(el(doc, "p", { class: "empty" }, t("tree.empty")));
    if (hadFocus) els[cursor]?.focus();
    moved(connectionRow());
  };

  const moveTo = (/** @type {number} */ index) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    els[cursor]?.setAttribute("aria-selected", "false");
    if (els[cursor]) /** @type {HTMLElement} */ (els[cursor]).tabIndex = -1;
    cursor = next;
    cursorKey = rows[cursor]?.key ?? "";
    moved(connectionRow());
    const node = els[cursor];
    if (!node) return;
    node.tabIndex = 0;
    node.setAttribute("aria-selected", "true");
    node.focus();
    node.scrollIntoView?.({ block: "nearest" });
  };

  /** Right opens a folder or steps into it; Left closes it or steps out to the parent. */
  const step = (/** @type {"expand" | "collapse"} */ way) => {
    const row = rows[cursor];
    if (!row) return;
    if (way === "expand") {
      if (row.expandable && !row.expanded) act("toggle", row, true);
      else if (row.expanded) moveTo(cursor + 1);
      return;
    }
    if (row.expandable && row.expanded) {
      act("toggle", row, false);
      return;
    }
    for (let i = cursor - 1; i >= 0; i--) {
      if ((rows[i]?.level ?? 0) < row.level) {
        moveTo(i);
        return;
      }
    }
  };

  tree.addEventListener("keydown", (event) => {
    const action = actionFor("explorer", pressOf(event));
    if (!action) return;
    event.preventDefault();
    const row = rows[cursor];
    if (action === "next") moveTo(cursor + 1);
    else if (action === "previous") moveTo(cursor - 1);
    else if (action === "first") moveTo(0);
    else if (action === "last") moveTo(rows.length - 1);
    else if (action === "expand" || action === "collapse") step(action);
    else if (action === "activate" && row) act("activate", row);
    else if (action === "edit" || action === "remove") act(action, row?.connection);
    else if (action === "refresh") act("refresh", row?.connection, row);
    else if (ROWS.has(action) && row) act(action, row);
    else if (!MOVES.has(action)) act(action);
  });
  tree.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const index = Number(
      /** @type {HTMLElement | null} */ (target?.closest("[role=treeitem]"))?.dataset.index,
    );
    if (Number.isNaN(index)) return;
    moveTo(index);
    const row = rows[index];
    if (row?.expandable && target?.classList.contains("caret")) act("toggle", row);
  });
  // A right click is the row's menu (the objects feature's), on that row.
  tree.addEventListener("contextmenu", (event) => {
    const item = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[role=treeitem]");
    const index = Number(/** @type {HTMLElement | null} */ (item)?.dataset.index);
    if (Number.isNaN(index) || !rows[index]) return;
    event.preventDefault();
    moveTo(index);
    act("objectMenu", rows[index]);
  });
  tree.addEventListener("dblclick", () => {
    const row = rows[cursor];
    if (row) act("activate", row);
  });

  return {
    render,
    focus: () => (els[cursor] ?? tree).focus(),
    /** The connection the cursor is in. */
    connection: () => rows[cursor]?.connection,
    /** The row an element is in, without moving the cursor (what a press on it drags). */
    nodeAt(/** @type {unknown} */ target) {
      const item = target instanceof Element ? target.closest("[role=treeitem]") : null;
      const index = Number(/** @type {HTMLElement | null} */ (item)?.dataset.index);
      return Number.isNaN(index) ? undefined : rows[index];
    },
  };
}
