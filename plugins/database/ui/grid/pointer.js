// The grid under the pointer and the clipboard: a click on a header sorts by its column (with Shift
// it adds the column as one more key), a click on a cell moves the cursor there (with Shift it
// extends the block) and a double click edits it, Mod+click on a foreign key's link cell follows it
// (PG-41), a right click opens the cell's menu, and Mod+C copies the block, or the cursor's cell, as
// tab-separated text, remembered so a paste of it reads its escapes back (clipboard.js). A header's
// drag and grip are header.js's.

import { remember } from "../clipboard.js";
import { formatRows } from "../results.js";

/**
 * @typedef {ReturnType<import("./screen.js").createScreen>} Screen
 * @typedef {{
 *   record(): boolean, editing(): boolean, sortBy(col: number, add: boolean): void,
 *   startEdit(): void, openMenu(at: { x: number, y: number }): void, follow(): void,
 *   selection(): ({ sorted: (string | null)[][], rows?: number[], columns?: number[] } | undefined),
 *   cursorRow(): number,
 * }} PointerActs
 */

const rowOf = (/** @type {Element | null | undefined} */ line) =>
  Number(line?.getAttribute("aria-rowindex")) - 2;
const colOf = (/** @type {Element} */ cell) => Number(cell.getAttribute("aria-colindex")) - 1;

/**
 * @param {Document} doc
 * @param {Screen} screen
 * @param {PointerActs} acts
 */
export function attachPointer(doc, screen, acts) {
  const { grid } = screen;
  grid.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const header = /** @type {HTMLElement | null} */ (target?.closest("[role=columnheader]"));
    if (header && !target?.closest(".grip")) {
      grid.focus();
      if (!acts.record()) acts.sortBy(screen.columnAt(Number(header.dataset.col)), event.shiftKey);
      return;
    }
    const cell = target?.closest("[role=gridcell]");
    const line = cell?.closest("[role=row]");
    if (!cell || !line) return;
    screen.moveTo(rowOf(line), colOf(cell), event.shiftKey);
    if ((event.metaKey || event.ctrlKey) && cell.classList.contains("link")) return acts.follow();
    // A double click edits the cell, here and not on dblclick: the second click's repaint has taken
    // the cell it lands on out of the page, so a dblclick never reaches the grid.
    if (event.detail === 2 && !event.shiftKey) acts.startEdit();
  });
  grid.addEventListener("contextmenu", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const cell = target?.closest("[role=gridcell], [role=columnheader]");
    if (!cell || !screen.set()) return;
    event.preventDefault();
    const line = cell.closest(".body [role=row]");
    screen.moveTo(line ? rowOf(line) : acts.cursorRow(), colOf(cell), false);
    acts.openMenu({ x: event.clientX, y: event.clientY });
  });
  // With nothing selected the copy event goes to the body, not to the focused grid.
  doc.addEventListener("copy", (event) => {
    if (!grid.contains(doc.activeElement) || acts.editing() || !screen.set()) return;
    const picked = acts.selection();
    if (!picked) return;
    const rows = picked.rows
      ? picked.rows.map((i) => picked.sorted[i] ?? [])
      : [picked.sorted[acts.cursorRow()] ?? []];
    const columns = picked.rows ? picked.columns : [screen.cursorColumn()];
    const text = formatRows(screen.set(), "tsv", { rows, columns });
    event.clipboardData?.setData("text/plain", text);
    remember(text);
    event.preventDefault();
  });
}
