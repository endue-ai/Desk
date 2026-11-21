// Drawing the grid's rows and header: each cell with its flags (NULL, a number, changed, the
// cursor, the selected block, a find match, pinned, a foreign key's link), each row marked when it
// is to be added or deleted, the header with its sort keys and a grip to resize. Only the columns of
// a lane are drawn: the pinned ones (sticky at the left), an empty gap as wide as the columns
// scrolled past, and the ones in view; the track after them keeps the row as wide as all its
// columns. The grid (view-grid.js) says what is where; this only makes the elements.

import { el } from "./dom.js";
import { cellText } from "./grid-model.js";

/**
 * @typedef {{ value: string | null, changed: boolean, inserted: boolean, deleted: boolean }} Cell
 * @typedef {{ top: number, bottom: number, left: number, right: number }} Block
 * @typedef {{ cols: number[], pinned: number, lefts: number[], template: string }} Lane
 *   `cols`: the screen columns drawn, the `pinned` first; `lefts`: each pinned one's sticky left;
 *   `template`: the rows' grid-template-columns, the gap's track after the pinned ones.
 * @typedef {{ name: string, key: string, number: boolean }} Head
 * @typedef {import("./grid/filters.js").SortKey} SortKey
 */

export const ROW = 24;
const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

/** A pinned cell's class and its sticky left. */
const pinning = (/** @type {Lane} */ lane, /** @type {number} */ i) =>
  i < lane.pinned
    ? {
        flags: i === lane.pinned - 1 ? " pinned pinned-edge" : " pinned",
        style: `left: ${lane.lefts[i] ?? 0}px`,
      }
    : { flags: "", style: undefined };

/** The gap after the pinned cells, which keeps the drawn ones where they are. */
const gap = (/** @type {Document} */ doc) =>
  el(doc, "div", { class: "gap", "aria-hidden": "true" });

/**
 * The rows `from` to `to` (screen rows), absolutely placed.
 * @param {Document} doc
 * @param {{
 *   from: number, to: number, lane: Lane, cell(r: number, c: number): Cell & { col?: number },
 *   block: Block, cursor: { row: number, col: number }, number(r: number, c: number): boolean,
 *   found(value: string | null): boolean, record: boolean, link?(r: number, c: number): string | undefined,
 * }} at `link` is a foreign key's cell's title (PG-41), undefined for a plain cell.
 */
export function drawRows(
  doc,
  { from, to, lane, cell: cellAt, block, cursor, number, found, record, link },
) {
  const drawn = [];
  for (let r = from; r < to; r++) {
    /** @type {HTMLElement[]} */
    const cells = [];
    let flags = "";
    lane.cols.forEach((c, i) => {
      if (i === lane.pinned) cells.push(gap(doc));
      const cell = cellAt(r, c);
      if (cell.deleted) flags = " deleted";
      else if (cell.inserted) flags = " inserted";
      const chosen = r >= block.top && r <= block.bottom && c >= block.left && c <= block.right;
      const pin = pinning(lane, i);
      const linked = cell.value !== null && (!record || c === 1) ? link?.(r, c) : undefined;
      const classes = [
        "cell",
        cell.value === null && (!record || c === 1) ? "null" : "",
        number(r, c) ? "number" : "",
        record && c === 0 ? "name" : "",
        cell.changed ? "changed" : "",
        chosen ? "chosen" : "",
        r === cursor.row && c === cursor.col ? "cursor" : "",
        (!record || c === 1) && found(cell.value) ? "found" : "",
        linked ? "link" : "",
      ];
      cells.push(
        el(
          doc,
          "div",
          {
            class: classes.filter(Boolean).join(" ") + pin.flags,
            role: "gridcell",
            "aria-colindex": String(c + 1),
            ...(cell.col === undefined ? {} : { "data-col": String(cell.col) }),
            ...(pin.style ? { style: pin.style } : {}),
            ...(chosen ? { "aria-selected": "true" } : {}),
            ...(cell.changed
              ? { title: "Changed, not submitted" }
              : linked
                ? { title: linked }
                : {}),
          },
          cellText(cell.value),
        ),
      );
    });
    if (lane.cols.length === lane.pinned) cells.push(gap(doc));
    const label = flags.trim() === "deleted" ? "To be deleted" : "To be added";
    drawn.push(
      el(
        doc,
        "div",
        {
          class: `grid-row${flags}`,
          role: "row",
          "aria-rowindex": String(r + 2),
          style: `top: ${r * ROW}px; grid-template-columns: ${lane.template}`,
          ...(flags ? { "aria-label": label } : {}),
        },
        ...cells,
      ),
    );
  }
  return drawn;
}

/**
 * The header cells of a lane: each column's name, its sort key's arrow (numbered when there are
 * several), and its grip. `aria-sort` is on the first key only, as ARIA asks; the others say their
 * place in words for a screen reader.
 * @param {Document} doc
 * @param {Head[]} heads By screen column.
 * @param {{ lane: Lane, record: boolean, sort: SortKey[] }} at
 */
export function drawHeader(doc, heads, { lane, record, sort }) {
  const out = [];
  lane.cols.forEach((c, i) => {
    if (i === lane.pinned) out.push(gap(doc));
    const head = heads[c] ?? { name: "", key: "", number: false };
    const at = record ? -1 : sort.findIndex((k) => k.key === head.key);
    const key = sort[at];
    const arrow = key
      ? `${key.direction === "asc" ? "▲" : "▼"}${sort.length > 1 ? at + 1 : ""}`
      : "";
    const pin = pinning(lane, i);
    out.push(
      el(
        doc,
        "div",
        {
          class: `cell header${!record && head.number ? " number" : ""}${pin.flags}`,
          role: "columnheader",
          "aria-colindex": String(c + 1),
          "aria-sort":
            at === 0 && key ? (key.direction === "asc" ? "ascending" : "descending") : "none",
          "data-col": String(c),
          ...(record ? {} : { "data-key": head.key }),
          ...(pin.style ? { style: pin.style } : {}),
        },
        el(doc, "span", { class: "label" }, head.name),
        arrow ? el(doc, "span", { class: "sort", "aria-hidden": "true" }, arrow) : undefined,
        key && at > 0
          ? el(
              doc,
              "span",
              { class: "sr-only" },
              `, sorted ${ORDINAL[at] ?? `${at + 1}th`}, ${key.direction === "asc" ? "ascending" : "descending"}`,
            )
          : undefined,
        record ? undefined : el(doc, "span", { class: "grip", "aria-hidden": "true" }),
      ),
    );
  });
  if (lane.cols.length === lane.pinned) out.push(gap(doc));
  return out;
}
