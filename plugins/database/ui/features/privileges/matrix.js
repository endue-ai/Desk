// The matrix of grantees and privileges (PG-54): a table with a row per grantee (and per column a
// grantee holds grants on), a cell per privilege that is a button showing none, granted (✓) or
// with its grant option (✓*), each grantor in its title, a cell the person pressed marked until
// the change is reviewed. A press calls `press` with the cell's state as shown; the controller
// turns it to the next one. Layout and colours: privileges.css.

import { el } from "../../dom.js";
import { rowPrivileges, shownState } from "./acl.js";

/**
 * @typedef {import("./acl.js").Matrix} Matrix
 * @typedef {import("./acl.js").CellState} CellState
 */

const GLYPHS = { none: "", granted: "✓", option: "✓*" };
const WORDS = { none: "not granted", granted: "granted", option: "granted with grant option" };

/**
 * @param {Document} doc
 * @param {Matrix} matrix
 * @param {Record<string, CellState>} edits
 * @param {{ label: string, press(cell: { grantee: string, column: string, privilege: string, now: CellState }): void, readOnly?: boolean }} options
 */
export function matrixTable(doc, matrix, edits, options) {
  const head = el(
    doc,
    "tr",
    {},
    el(doc, "th", { scope: "col" }, "Grantee"),
    ...matrix.privileges.map((p) => el(doc, "th", { scope: "col", class: "privileges-priv" }, p)),
  );
  const rows = matrix.rows.map((row) => {
    const own = rowPrivileges(matrix, row);
    const who = row.column ? `${row.grantee} · ${row.column}` : row.grantee;
    return el(
      doc,
      "tr",
      { "data-grantee": row.grantee, "data-column": row.column },
      el(doc, "th", { scope: "row", class: row.column ? "privileges-column" : "" }, who),
      ...matrix.privileges.map((privilege) => {
        if (!own.includes(privilege)) return el(doc, "td", { class: "privileges-none" });
        const before = row.cells[privilege]?.state ?? "none";
        const now = shownState(row, privilege, edits);
        const grantors = (row.cells[privilege]?.grantors ?? [])
          .map((g) => `${g.name}${g.option ? " (with grant option)" : ""}`)
          .join(", ");
        const title = `${privilege} to ${who}: ${WORDS[now]}${grantors ? `; granted by ${grantors}` : ""}${now !== before ? ` (was ${WORDS[before]})` : ""}`;
        const button = /** @type {HTMLButtonElement} */ (
          el(
            doc,
            "button",
            {
              type: "button",
              class: `privileges-cell${now !== before ? " pending" : ""}`,
              "data-privilege": privilege,
              "data-state": now,
              "aria-label": title,
              title,
              disabled: options.readOnly === true,
            },
            GLYPHS[now],
          )
        );
        button.addEventListener("click", () =>
          options.press({ grantee: row.grantee, column: row.column, privilege, now }),
        );
        return el(doc, "td", {}, button);
      }),
    );
  });
  return el(
    doc,
    "div",
    { class: "privileges-matrix-wrap" },
    el(
      doc,
      "table",
      { class: "desk-table privileges-matrix", "aria-label": options.label },
      el(doc, "thead", {}, head),
      el(doc, "tbody", {}, ...rows),
    ),
    el(
      doc,
      "p",
      { class: "hint" },
      "✓ granted · ✓* with grant option · a press goes none, ✓, ✓*; marked cells change when reviewed.",
    ),
  );
}
