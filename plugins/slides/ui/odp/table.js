// ODF tables in presentations: columns and rows with their sizes, cells with spans and covered cells,
// fills and borders from the cell styles (and the table template's body and first row), cell text.
import { NO_FILL, textOf } from "../deck.js";
import { attr, kids } from "../xml.js";
import { chainOf, fillFrom, length, propsOf } from "./style.js";
import { readParagraphs } from "./text.js";

/**
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Line} Line
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("./style.js").Styles} Styles
 */

/** "0.03pt solid #000000" as a line, or null. @returns {Line | null} */
function border(/** @type {string | undefined} */ value) {
  if (!value || value === "none") return null;
  const color = /#[0-9a-f]{6}/i.exec(value)?.[0] ?? "#000000";
  const width = length(
    value.split(/\s+/).find((p) => /^[\d.]+[a-z]+$/i.test(p)),
    0.75,
  );
  if (/\bnone\b|\bhidden\b/.test(value)) return null;
  return {
    color: color.toLowerCase(),
    width: Math.max(0.5, width),
    dash: /dash|dot/.test(value) ? "dash" : "solid",
    head: "none",
    tail: "none",
  };
}

/**
 * @param {Element} table  table:table
 * @param {Box} box
 * @param {string} name
 * @param {Styles} index
 * @returns {SlideElement}
 */
export function readOdpTable(table, box, name, index) {
  /** @type {number[]} */
  const columns = [];
  for (const col of kids(table, "table-column", "table-columns")) {
    const cols = col.localName === "table-columns" ? kids(col, "table-column") : [col];
    for (const c of cols) {
      const repeat = Number.parseInt(attr(c, "number-columns-repeated") ?? "1", 10) || 1;
      const width = length(
        propsOf(chainOf(index, "table-column", attr(c, "style-name")), "table-column-properties")[
          "column-width"
        ],
      );
      for (let i = 0; i < Math.min(repeat, 256); i++) columns.push(width);
    }
  }
  const template = index.named("table-template", attr(table, "template-name"));
  const part = (/** @type {string} */ which) => attr(kids(template, which)[0], "style-name");
  const rowsEls = kids(table, "table-row", "table-rows", "table-header-rows").flatMap((r) =>
    r.localName === "table-row" ? [r] : kids(r, "table-row"),
  );
  const rows = rowsEls.map((tr, r) => {
    const rowProps = propsOf(
      chainOf(index, "table-row", attr(tr, "style-name")),
      "table-row-properties",
    );
    const cells = kids(tr, "table-cell", "covered-table-cell").map((tc) => {
      const parts = [part("body")];
      if (attr(table, "use-banding-rows-styles") === "true")
        parts.push(part(r % 2 ? "even-rows" : "odd-rows"));
      if (r === 0 && attr(table, "use-first-row-styles") === "true") parts.push(part("first-row"));
      const chain = [
        ...parts.flatMap((p) => chainOf(index, "table-cell", p)),
        ...chainOf(
          index,
          "table-cell",
          attr(tc, "style-name") ?? attr(tr, "default-cell-style-name"),
        ),
      ];
      const graphic = propsOf(chain, "graphic-properties");
      const cellProps = propsOf(chain, "table-cell-properties");
      const background = cellProps["background-color"];
      const fill =
        fillFrom(graphic, index) ??
        (background && background !== "transparent"
          ? { type: "solid", color: background.toLowerCase() }
          : NO_FILL);
      const all = cellProps.border;
      const align = cellProps["vertical-align"];
      return {
        text: textOf(readParagraphs(tc, { index, frame: chain, listStyle: null }), {
          anchor: align === "middle" ? "middle" : align === "bottom" ? "bottom" : "top",
          inset: {
            left: length(cellProps["padding-left"] ?? cellProps.padding, 7.2),
            right: length(cellProps["padding-right"] ?? cellProps.padding, 7.2),
            top: length(cellProps["padding-top"] ?? cellProps.padding, 3.6),
            bottom: length(cellProps["padding-bottom"] ?? cellProps.padding, 3.6),
          },
        }),
        fill: /** @type {import("../deck.js").Fill} */ (fill),
        borders: {
          left: border(cellProps["border-left"] ?? all),
          right: border(cellProps["border-right"] ?? all),
          top: border(cellProps["border-top"] ?? all),
          bottom: border(cellProps["border-bottom"] ?? all),
        },
        colSpan: Number.parseInt(attr(tc, "number-columns-spanned") ?? "1", 10) || 1,
        rowSpan: Number.parseInt(attr(tc, "number-rows-spanned") ?? "1", 10) || 1,
        merged: tc.localName === "covered-table-cell",
      };
    });
    return { height: length(rowProps["row-height"] ?? rowProps["min-row-height"]), cells };
  });
  // Sizes it cannot read share the frame evenly; sizes it can are kept.
  const width = columns.reduce((a, b) => a + b, 0);
  const count = Math.max(columns.length, ...rows.map((r) => r.cells.length));
  const cols = width > 0 ? columns : Array(count).fill(box.w / Math.max(1, count));
  const height = rows.reduce((a, r) => a + r.height, 0);
  if (height === 0) for (const row of rows) row.height = box.h / Math.max(1, rows.length);
  return { type: "table", name, box, columns: cols, rows };
}
