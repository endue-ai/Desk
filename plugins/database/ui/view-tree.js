// The explorer's DOM: the controller's flat rows as a tree (role=tree, aria-level, aria-expanded),
// a cursor the arrow keys move and that stays on its row across a redraw, Right and Left to open
// and close (or go to the parent), Enter to open a console or a table, single keys for the rest.

import { el } from "./dom.js";
import { actionFor, pressOf } from "./keys.js";

/**
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const MOVES = new Set(["next", "previous", "first", "last"]);

/**
 * @param {Document} doc
 * @param {HTMLElement} tree
 * @param {Act} act
 */
export function createTree(doc, tree, act) {
  /** @type {Node[]} */
  let rows = [];
  /** @type {HTMLElement[]} */
  let els = [];
  let cursor = 0;
  let cursorKey = "";

  const render = (/** @type {Node[]} */ next) => {
    rows = next;
    const found = rows.findIndex((row) => row.key === cursorKey);
    cursor = found >= 0 ? found : Math.min(cursor, Math.max(0, rows.length - 1));
    const hadFocus = tree.contains(doc.activeElement);
    els = rows.map((row, index) => {
      const caret = row.expandable
        ? el(doc, "span", { class: "caret", "aria-hidden": "true" }, row.expanded ? "▾" : "▸")
        : el(doc, "span", { class: "caret" });
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
        el(doc, "span", { class: "label" }, row.label),
        tag,
        row.detail ? el(doc, "span", { class: "detail" }, row.detail) : undefined,
      );
      node.tabIndex = index === cursor ? 0 : -1;
      return node;
    });
    tree.replaceChildren(...els);
    if (rows.length === 0)
      tree.append(el(doc, "p", { class: "empty" }, "No connections yet. Press n to add one."));
    if (hadFocus) els[cursor]?.focus();
  };

  const moveTo = (/** @type {number} */ index) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    els[cursor]?.setAttribute("aria-selected", "false");
    if (els[cursor]) /** @type {HTMLElement} */ (els[cursor]).tabIndex = -1;
    cursor = next;
    cursorKey = rows[cursor]?.key ?? "";
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
    else if (action === "refresh") act("refresh", row?.connection);
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
  tree.addEventListener("dblclick", () => {
    const row = rows[cursor];
    if (row) act("activate", row);
  });

  return {
    render,
    focus: () => (els[cursor] ?? tree).focus(),
    /** The connection the cursor is in. */
    connection: () => rows[cursor]?.connection,
  };
}
