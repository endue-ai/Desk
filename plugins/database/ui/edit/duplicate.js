// Duplicating rows as pending rows (PG-43, ADR 0115): each row given becomes a new row with the same
// values (with their pending changes; a pending row's columns left to their default stay so), except
// the columns the server fills: an identity column (always or by default), a generated one, one whose
// default is a sequence's nextval(), a primary key column with a default, and SQLite's INTEGER
// PRIMARY KEY. Those take DEFAULT and are named; a key copied as it was is named too, since it must
// change before Submit. Pure.

import { cellAt } from "./pending.js";

/**
 * @typedef {import("./pending.js").Target} Target
 * @typedef {import("./pending.js").Changes} Changes
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 */

/** Whether the server fills a column of a new row when it is left out. */
function serverFills(/** @type {Target} */ target, /** @type {number} */ col) {
  const column = target.columns[col];
  if (!column?.known) return false;
  if (column.editor?.fixed || column.editor?.auto) return true;
  if (!target.key.includes(col)) return false;
  if (column.editor?.hasDefault) return true;
  return (
    target.dialect === "sqlite" && target.key.length === 1 && /^integer$/iu.test(column.type.trim())
  );
}

/**
 * Add a pending row for each row given, in that order.
 * @param {Changes} changes
 * @param {Target} target
 * @param {ResultSet} set
 * @param {number[]} rows Result rows, a pending row's past the server's.
 * @returns {{ added: number, left: string[], keys: string[] }} `left`: the columns that take their
 *   DEFAULT; `keys`: the key columns copied, which must change before Submit.
 */
export function duplicateRows(changes, target, set, rows) {
  const left = target.columns.flatMap((_, col) => (serverFills(target, col) ? [col] : []));
  const values = rows.map((row) => {
    const pending = row >= set.rows.length ? changes.inserts[row - set.rows.length] : undefined;
    return target.columns.map((column, col) => {
      if (!column.known || left.includes(col)) return undefined;
      return pending ? pending[col] : cellAt(changes, set, row, col).value;
    });
  });
  changes.inserts.push(...values);
  const name = (/** @type {number} */ col) => target.columns[col]?.name ?? "";
  return {
    added: rows.length,
    left: left.map(name),
    keys: target.key.filter((col) => !left.includes(col)).map(name),
  };
}
