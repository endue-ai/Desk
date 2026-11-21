// INSERT's column counts, as the server checks them before it binds anything (ADR 0294): VALUES rows
// of different lengths, more values than columns (the list, or the table's columns when there is
// none) and, with a column list, more columns than values; each placed where the server points (the
// first value or column too many). An INSERT ... SELECT counts the select list, unless it has a `*`
// or is a UNION. Pure.
import { fieldsOf, kindOf, listOf } from "../sql/parse/tree.js";
import { relationIn } from "./names.js";

/**
 * @typedef {import("../sql/parse/tree.js").Node} Node
 * @typedef {import("./names.js").Problem} Problem
 * @typedef {import("./script.js").State} State
 */

/** Where an expression starts: its leftmost location, as the server's exprLocation answers. */
export function startOf(/** @type {unknown} */ node) {
  let best = Number.POSITIVE_INFINITY;
  /** @type {unknown[]} */
  const stack = [node];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, inner] of Object.entries(value)) {
      if (key === "location" && typeof inner === "number" && inner >= 0)
        best = Math.min(best, inner);
      else if (inner && typeof inner === "object") stack.push(inner);
    }
  }
  return Number.isFinite(best) ? best : -1;
}

/** The rows an INSERT writes: its VALUES lists, or the one row of a plain SELECT; null when unknown. */
function rowsOf(/** @type {Node | undefined} */ select) {
  const s = fieldsOf(select, "SelectStmt");
  if (!s) return null;
  if (s.valuesLists)
    return listOf(s.valuesLists).map((row) => listOf(fieldsOf(row, "List")?.items));
  if (s.op && s.op !== "SETOP_NONE") return null;
  const targets = listOf(s.targetList);
  const star = targets.some((t) =>
    listOf(fieldsOf(fieldsOf(t, "ResTarget")?.val, "ColumnRef")?.fields).some(
      (f) => kindOf(f) === "A_Star",
    ),
  );
  return star || targets.length === 0 ? null : [targets.map((t) => fieldsOf(t, "ResTarget")?.val)];
}

/**
 * The count problems of one statement.
 * @param {Node} tree
 * @param {State} state
 * @param {(byte: number) => number} offsetOf a byte of the parsed text as its offset
 * @param {(offset: number, expression: boolean) => number} endAt where the token or expression ends
 * @returns {Problem[]}
 */
export function insertProblems(tree, state, offsetOf, endAt) {
  const f = fieldsOf(tree, "InsertStmt");
  if (!f || state.opaque) return [];
  const rows = rowsOf(f.selectStmt);
  if (!rows || rows.length === 0) return [];
  const at = (/** @type {number} */ byte, /** @type {string} */ message, expression = true) => {
    const from = offsetOf(byte);
    return [{ from, to: endAt(from, expression), kind: /** @type {const} */ ("names"), message }];
  };
  const width = rows[0]?.length ?? 0;
  const uneven = rows.find((row) => row.length !== width);
  if (uneven) return at(startOf(uneven[0]), "VALUES lists must all be the same length");
  const cols = listOf(f.cols).map((c) => fieldsOf(c, "ResTarget"));
  const known = cols.length > 0 ? cols.length : columnsOf(state, f.relation);
  const values = /** @type {unknown[]} */ (rows[0]);
  if (known !== null && values.length > known)
    return at(startOf(values[known]), "INSERT has more expressions than target columns");
  if (cols.length > 0 && values.length < cols.length)
    return at(
      cols[values.length]?.location ?? -1,
      "INSERT has more target columns than expressions",
      false,
    );
  return [];
}

/** How many columns the target relation has, when the model knows. */
function columnsOf(/** @type {State} */ state, /** @type {Node | undefined} */ rv) {
  if (!rv?.relname) return null;
  const found = relationIn(state, rv.schemaname ?? null, rv.relname)?.found;
  return found?.columns ? found.columns.size : null;
}
