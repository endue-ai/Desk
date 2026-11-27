// The panel's Export menu (PG-55): SVG, PNG or PNG at 2x to a file, or a PNG on the clipboard. A
// <desk-menu>, so arrows, Enter and Escape work in it; a plain element where it is not defined (the
// unit tests' jsdom), shown and hidden by `hidden`.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {HTMLElement & { show?(anchor: HTMLElement): void, close?(): void }} Menu
 * @typedef {"svg" | "png" | "png2x" | "copy"} Choice
 */

const ITEM = { role: "menuitem", tabindex: "-1" };
const FILES = /** @type {const} */ ([
  ["svg", "SVG, vector"],
  ["png", "PNG"],
  ["png2x", "PNG at 2x"],
]);

/**
 * @param {Document} doc
 * @param {HTMLElement} home Where the menu lives in the page.
 * @param {(choice: Choice) => void} choose
 */
export function createExportMenu(doc, home, choose) {
  const menu = /** @type {Menu} */ (
    el(
      doc,
      "desk-menu",
      { class: "er-export-menu", label: t("features.diagram.exportMenu.exportTheDiagram") },
      ...FILES.map(([format, label]) =>
        el(
          doc,
          "div",
          { ...ITEM, "data-choice": format },
          t("features.diagram.exportMenu.exportAs", { label: String(label) }),
        ),
      ),
      el(doc, "div", { role: "separator" }),
      el(
        doc,
        "div",
        { ...ITEM, "data-choice": "copy" },
        t("features.diagram.exportMenu.copyAsAnImage"),
      ),
    )
  );
  if (!menu.show) menu.hidden = true;
  home.append(menu);
  menu.addEventListener("desk-select", (event) => {
    const item = /** @type {CustomEvent<{ item: HTMLElement }>} */ (event).detail.item;
    if (!menu.show) menu.hidden = true;
    const choice = /** @type {Choice | undefined} */ (item.dataset.choice);
    if (choice) choose(choice);
  });
  return {
    el: menu,
    /** Open below the button that asked for it. */
    open(/** @type {HTMLElement} */ anchor) {
      if (menu.show) menu.show(anchor);
      else menu.hidden = false;
    },
    destroy: () => menu.remove(),
  };
}
