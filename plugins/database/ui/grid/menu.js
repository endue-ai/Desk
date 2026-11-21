// The cell's menu (f in the grid, the context menu key or a right click): the quick filters for its
// value, then what can be done with its column (sort by it next, hide, pin, fit, show a hidden one,
// reset). It scrolls when the page is too short for it.
// A <desk-menu>, so arrows, Enter and Escape work in it; the grid gets its focus back when it closes.

import { el } from "../dom.js";
import { menuLabel, OPS, WITH_VALUE } from "./filters.js";

/**
 * @typedef {HTMLElement & { open?: boolean, show?(anchor: HTMLElement): void, close?(): void }} Menu
 *   A <desk-menu>; a plain element where it is not defined (the unit tests' jsdom).
 * @typedef {{ value: string | null, numeric: boolean, pinned: boolean, sortable: boolean, hidden: number }} Of
 * @typedef {{ filter(op: string): void, column(action: string): void, closed(): void }} MenuActs
 */

/** An item's role is set here: the menu sets it only once its slot has changed. */
const ITEM = { role: "menuitem", tabindex: "-1" };

const COLUMN = [
  ["addSort", "Sort by it next (S)"],
  ["hide", "Hide the column (h)"],
  ["pin", "Pin the column (P)"],
  ["fit", "Fit to its content (w)"],
  ["showColumns", "Show a hidden column (H)"],
  ["reset", "Reset the columns"],
];

/**
 * @param {Document} doc
 * @param {HTMLElement} home Where the menu lives in the page.
 * @param {MenuActs} acts
 */
export function createCellMenu(doc, home, acts) {
  const menu = /** @type {Menu} */ (el(doc, "desk-menu", { class: "grid-menu", label: "Cell" }));
  if (!menu.show) menu.hidden = true;
  home.append(menu);
  menu.addEventListener("desk-select", (event) => {
    const item = /** @type {CustomEvent<{ item: HTMLElement }>} */ (event).detail.item;
    if (item.dataset.filter) acts.filter(item.dataset.filter);
    else if (item.dataset.column) acts.column(item.dataset.column);
    if (!menu.show) menu.hidden = true;
  });
  menu.addEventListener("close", () => acts.closed());

  return {
    /**
     * Open by a cell, or at a point (a right click).
     * @param {HTMLElement} anchor
     * @param {Of} of
     * @param {{ x: number, y: number }} [at]
     */
    open(anchor, of, at) {
      const items = OPS.map((op) => {
        const off = WITH_VALUE.has(op) && of.value === null;
        return el(
          doc,
          "div",
          { ...ITEM, "data-filter": op, ...(off ? { "aria-disabled": "true" } : {}) },
          menuLabel(op, of.value, of.numeric),
        );
      });
      const column = COLUMN.filter(
        ([action]) =>
          (of.sortable || action !== "addSort") && (action !== "showColumns" || of.hidden > 0),
      ).map(([action, label]) =>
        el(
          doc,
          "div",
          { ...ITEM, "data-column": action },
          action === "pin" && of.pinned ? "Unpin the column (P)" : (label ?? ""),
        ),
      );
      menu.replaceChildren(...items, el(doc, "div", { role: "separator" }), ...column);
      if (menu.show) menu.show(anchor);
      else menu.hidden = false;
      if (at) {
        menu.style.left = `${at.x}px`;
        menu.style.top = `${at.y}px`;
      }
      const page = doc.documentElement;
      const box = menu.getBoundingClientRect();
      if (box.bottom > page.clientHeight && page.clientHeight > 0)
        menu.style.top = `${Math.max(4, page.clientHeight - box.height - 4)}px`;
      if (box.right > page.clientWidth && page.clientWidth > 0)
        menu.style.left = `${Math.max(4, page.clientWidth - box.width - 4)}px`;
    },
  };
}
