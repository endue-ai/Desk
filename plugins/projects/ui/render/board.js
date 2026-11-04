// The Kanban board and the swimlanes: a column per status, cards most urgent first, and for the
// swimlanes a row per lane over the same columns. Every column (and cell) is a drop target that
// names its column and lane; view.js turns a drop into a move.
import { CATEGORY_TITLES } from "../adapters/common.js";
import { card, h } from "./dom.js";

/**
 * @typedef {import("../layout/board.js").Column} Column
 * @typedef {import("../layout/board.js").Lane} Lane
 * @typedef {import("./dom.js").CardContext} CardContext
 */

/** A column's heading: its category's mark, its name and how many cards it holds. */
function heading(
  /** @type {Document} */ doc,
  /** @type {Column} */ column,
  /** @type {number} */ count,
) {
  return h(doc, "header", { class: "column-head" }, [
    h(doc, "span", { class: `dot ${column.category}`, title: CATEGORY_TITLES[column.category] }),
    h(doc, "h2", { text: column.title }),
    h(doc, "span", { class: "count", text: String(count) }),
  ]);
}

/** @param {Document} doc @param {{ columns: Column[] }} body @param {CardContext} c */
export function renderKanban(doc, body, c) {
  return h(
    doc,
    "div",
    { class: "board", role: "group", "aria-label": "Kanban board" },
    body.columns.map((column, index) =>
      h(
        doc,
        "section",
        { class: "column", "data-category": column.category, "aria-label": column.title },
        [
          heading(doc, column, column.works.length),
          h(
            doc,
            "div",
            { class: "cards", "data-drop": "column", "data-column": index },
            column.works.length
              ? column.works.map((w) => card(doc, w, c))
              : [h(doc, "p", { class: "placeholder", text: "Nothing here" })],
          ),
        ],
      ),
    ),
  );
}

/** @param {Document} doc @param {{ columns: Column[], lanes: Lane[] }} body @param {CardContext} c */
export function renderSwimlane(doc, body, c) {
  const grid = h(doc, "div", { class: "lanes", role: "group", "aria-label": "Swimlanes" }, [
    h(doc, "div", { class: "lane-corner" }),
    ...body.columns.map((column) =>
      h(doc, "div", { class: "lane-column", "data-category": column.category }, [
        heading(doc, column, column.works.length),
      ]),
    ),
    ...body.lanes.flatMap((lane, row) => [
      h(doc, "div", { class: "lane-title" }, [
        h(doc, "h3", { text: lane.title }),
        h(doc, "span", { class: "count", text: String(lane.count) }),
      ]),
      ...lane.cells.map((works, index) =>
        h(
          doc,
          "div",
          {
            class: "cell cards",
            "data-drop": "cell",
            "data-column": index,
            "data-lane": row,
            "aria-label": `${lane.title}, ${body.columns[index]?.title ?? ""}`,
          },
          works.map((w) => card(doc, w, c)),
        ),
      ),
    ]),
  ]);
  grid.style.setProperty("--columns", String(Math.max(body.columns.length, 1)));
  return grid;
}
