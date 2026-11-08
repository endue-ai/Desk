// Drawing the grid's rows and header: each cell with its flags (NULL, a number, changed, the
// cursor, the selected block), each row marked when it is to be added or deleted, the header with
// its sort. The grid (view-grid.js) says what is where; this only makes the elements.

import { el } from "./dom.js";
import { cellText } from "./grid-model.js";

/**
 * @typedef {{ value: string | null, changed: boolean, inserted: boolean, deleted: boolean }} Cell
 * @typedef {{ top: number, bottom: number, left: number, right: number }} Block
 */

export const ROW = 24;

/**
 * The rows `from` to `to` (screen rows), absolutely placed.
 * @param {Document} doc
 * @param {{
 *   from: number, to: number, cols: number, cell(r: number, c: number): Cell, block: Block,
 *   cursor: { row: number, col: number }, numeric: boolean[], record: boolean, template: string,
 * }} at
 */
export function drawRows(
  doc,
  { from, to, cols, cell: cellAt, block, cursor, numeric, record, template },
) {
  const drawn = [];
  for (let r = from; r < to; r++) {
    const cells = [];
    let flags = "";
    for (let c = 0; c < cols; c++) {
      const cell = cellAt(r, c);
      if (cell.deleted) flags = " deleted";
      else if (cell.inserted) flags = " inserted";
      const chosen = r >= block.top && r <= block.bottom && c >= block.left && c <= block.right;
      const numberish = record ? c === 1 && numeric[r] : numeric[c];
      const classes = [
        "cell",
        cell.value === null && (!record || c === 1) ? "null" : "",
        numberish ? "number" : "",
        record && c === 0 ? "name" : "",
        cell.changed ? "changed" : "",
        chosen ? "chosen" : "",
        r === cursor.row && c === cursor.col ? "cursor" : "",
      ];
      cells.push(
        el(
          doc,
          "div",
          {
            class: classes.filter(Boolean).join(" "),
            role: "gridcell",
            "aria-colindex": String(c + 1),
            ...(chosen ? { "aria-selected": "true" } : {}),
            ...(cell.changed ? { title: "Changed, not submitted" } : {}),
          },
          cellText(cell.value),
        ),
      );
    }
    const label = flags.trim() === "deleted" ? "To be deleted" : "To be added";
    drawn.push(
      el(
        doc,
        "div",
        {
          class: `grid-row${flags}`,
          role: "row",
          "aria-rowindex": String(r + 2),
          style: `top: ${r * ROW}px; grid-template-columns: ${template}`,
          ...(flags ? { "aria-label": label } : {}),
        },
        ...cells,
      ),
    );
  }
  return drawn;
}

/**
 * The header cells, with the sort shown on its column.
 * @param {Document} doc
 * @param {string[]} names
 * @param {{ numeric: boolean[], record: boolean, sort: import("./grid-model.js").Sort }} at
 */
export function drawHeader(doc, names, { numeric, record, sort }) {
  return names.map((name, c) => {
    const sorted = !record && sort?.column === c;
    return el(
      doc,
      "div",
      {
        class: `cell header${!record && numeric[c] ? " number" : ""}`,
        role: "columnheader",
        "aria-colindex": String(c + 1),
        "aria-sort": sorted ? (sort?.direction === "asc" ? "ascending" : "descending") : "none",
        "data-col": String(c),
      },
      name,
    );
  });
}
