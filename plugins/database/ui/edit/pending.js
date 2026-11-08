// Pending changes to a result's rows (DB-14, ADR 0115): cells changed, rows added and rows deleted
// are kept apart from the rows the server sent, drawn as a diff, and turned into one transaction of
// statements keyed on the table's primary key. Nothing here runs SQL; submit.js does. A result can
// be changed only when it is one table's rows with every primary key column in it, on a connection
// that is not read-only. Pure, so every rule is tested without a DOM or a client.

import { qualified } from "../sql/quote.js";
import { literal } from "./values.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {{ name: string, type: string, key: boolean, known: boolean }} TargetColumn
 *   One per result column: its table column's type, whether it is part of the primary key, and
 *   `known: false` for a result column that is no column of the table (an expression).
 * @typedef {{ dialect: Dialect, schema: string, name: string, columns: TargetColumn[], key: number[] }} Target
 *   `key` holds the result columns of the primary key, in the key's order.
 * @typedef {(string | null | undefined)[]} NewRow `undefined` leaves the column to its default.
 * @typedef {{ updates: Map<number, Map<number, string | null>>, inserts: NewRow[], deletes: Set<number> }} Changes
 * @typedef {{ kind: "update" | "insert" | "delete", row: number, sql: string }} Change
 *   `row` is the result row (for an insert, rows.length + its index among the inserts).
 */

/** @returns {Changes} */
export function emptyChanges() {
  return { updates: new Map(), inserts: [], deletes: new Set() };
}

/** How many rows have a pending change. */
export function countChanges(/** @type {Changes} */ changes) {
  return changes.updates.size + changes.inserts.length + changes.deletes.size;
}

/**
 * Why a result's rows cannot be changed, or "" when they can.
 * @param {{ name: string, readOnly: boolean }} conn
 * @param {Target | undefined} target
 * @param {string} [missing] Why no target was found, when there is none.
 */
export function refusalOf(conn, target, missing = "") {
  if (conn.readOnly) return `${conn.name} is read-only: its rows cannot be changed here.`;
  if (!target)
    return missing || "Only one table's rows can be changed: this result does not come from one.";
  if (target.key.length === 0)
    return `${target.name} has no primary key, so its rows cannot be told apart: edits are refused.`;
  return "";
}

/**
 * The target of a result: the table's columns lined up with the result's.
 * @param {Dialect} dialect
 * @param {{ schema: string, name: string }} table
 * @param {string[]} resultColumns
 * @param {{ name: string, type: string, primary: boolean }[]} tableColumns The catalog's, in order.
 * @returns {{ target?: Target, reason: string }}
 */
export function targetOf(dialect, table, resultColumns, tableColumns) {
  const seen = new Set();
  /** @type {TargetColumn[]} */
  // PostgreSQL names columns exactly; MySQL and SQLite match them without case.
  const fold = (/** @type {string} */ s) => (dialect === "postgresql" ? s : s.toLowerCase());
  const columns = resultColumns.map((name) => {
    const column =
      tableColumns.find((c) => c.name === name) ??
      tableColumns.find((c) => fold(c.name) === fold(name));
    const twice = column ? seen.has(column.name) : false;
    if (column) seen.add(column.name);
    return column && !twice
      ? { name: column.name, type: column.type, key: column.primary, known: true }
      : { name, type: "", key: false, known: false };
  });
  const primary = tableColumns.filter((c) => c.primary);
  if (primary.length === 0) {
    const target = { dialect, schema: table.schema, name: table.name, columns, key: [] };
    return { target, reason: "" };
  }
  const key = primary.map((c) => columns.findIndex((r) => r.known && r.name === c.name));
  const lacking = primary.filter((_, i) => (key[i] ?? -1) < 0).map((c) => c.name);
  if (lacking.length)
    return {
      reason: `The result lacks ${lacking.join(", ")} of ${table.name}'s primary key: add it to change rows.`,
    };
  return { target: { dialect, schema: table.schema, name: table.name, columns, key }, reason: "" };
}

/** The value a cell shows, with its pending change. */
export function cellAt(
  /** @type {Changes} */ changes,
  /** @type {ResultSet} */ set,
  /** @type {number} */ row,
  /** @type {number} */ col,
) {
  if (row >= set.rows.length) {
    const value = changes.inserts[row - set.rows.length]?.[col];
    return { value: value ?? null, changed: value !== undefined, inserted: true, deleted: false };
  }
  const update = changes.updates.get(row);
  const changed = update?.has(col) ?? false;
  const value = changed ? (update?.get(col) ?? null) : (set.rows[row]?.[col] ?? null);
  return { value, changed, inserted: false, deleted: changes.deletes.has(row) };
}

/**
 * Change a cell: a row of the result (kept apart, dropped again when it is set back to what it was)
 * or a row added. Throws with the sentence to show when the cell cannot change.
 * @param {Changes} changes
 * @param {Target} target
 * @param {ResultSet} set
 * @param {number} row
 * @param {number} col
 * @param {string | null} value
 */
export function editCell(changes, target, set, row, col, value) {
  const column = target.columns[col];
  if (!column?.known)
    throw new Error(
      `${column?.name ?? "This"} is not a column of ${target.name}: it cannot change.`,
    );
  if (row >= set.rows.length) {
    const added = changes.inserts[row - set.rows.length];
    if (!added) throw new Error("That row is gone.");
    added[col] = value;
    return;
  }
  if (changes.deletes.has(row)) throw new Error("That row is deleted: restore it first.");
  const original = set.rows[row];
  if (!original) throw new Error("That row is gone.");
  keyOf(target, original);
  const update = changes.updates.get(row) ?? new Map();
  if ((original[col] ?? null) === value) update.delete(col);
  else update.set(col, value);
  if (update.size) changes.updates.set(row, update);
  else changes.updates.delete(row);
}

/** Add an empty row (every column left to its default); answers its row number. */
export function addRow(
  /** @type {Changes} */ changes,
  /** @type {Target} */ target,
  /** @type {ResultSet} */ set,
) {
  changes.inserts.push(target.columns.map(() => undefined));
  return set.rows.length + changes.inserts.length - 1;
}

/** Delete rows: a result row is marked (its cell changes dropped), an added row goes. */
export function deleteRows(
  /** @type {Changes} */ changes,
  /** @type {Target} */ target,
  /** @type {ResultSet} */ set,
  /** @type {number[]} */ rows,
) {
  const added = rows.filter((r) => r >= set.rows.length).map((r) => r - set.rows.length);
  for (const row of rows) {
    const original = set.rows[row];
    if (row >= set.rows.length || !original) continue;
    keyOf(target, original);
    changes.updates.delete(row);
    changes.deletes.add(row);
  }
  changes.inserts = changes.inserts.filter((_, i) => !added.includes(i));
}

/** Take back the pending changes of some rows, or of all. */
export function revertRows(
  /** @type {Changes} */ changes,
  /** @type {ResultSet} */ set,
  /** @type {number[] | undefined} */ rows,
) {
  if (!rows) {
    changes.updates.clear();
    changes.deletes.clear();
    changes.inserts = [];
    return;
  }
  for (const row of rows) {
    changes.updates.delete(row);
    changes.deletes.delete(row);
  }
  const added = rows.filter((r) => r >= set.rows.length).map((r) => r - set.rows.length);
  changes.inserts = changes.inserts.filter((_, i) => !added.includes(i));
}

/**
 * The statements that apply the changes, in the order they run: deletes, updates, then inserts, so
 * a deleted key can be added again. Each is keyed on the row's primary key as the server sent it.
 * @param {Target} target
 * @param {ResultSet} set
 * @param {Changes} changes
 * @returns {Change[]}
 */
export function planChanges(target, set, changes) {
  const { dialect } = target;
  const table = qualified(dialect, dialect === "sqlite" ? "" : target.schema, target.name);
  const name = (/** @type {number} */ c) => qualified(dialect, "", target.columns[c]?.name ?? "");
  const value = (/** @type {number} */ c, /** @type {string | null} */ v) =>
    literal(dialect, v, target.columns[c]?.type ?? "");
  /** @type {Change[]} */
  const out = [];
  for (const row of [...changes.deletes].sort((a, b) => a - b)) {
    const where = keyOf(target, /** @type {(string | null)[]} */ (set.rows[row]));
    out.push({ kind: "delete", row, sql: `DELETE FROM ${table} WHERE ${where}` });
  }
  for (const [row, cells] of [...changes.updates].sort(([a], [b]) => a - b)) {
    const where = keyOf(target, /** @type {(string | null)[]} */ (set.rows[row]));
    const sets = [...cells]
      .sort(([a], [b]) => a - b)
      .map(([c, v]) => `${name(c)} = ${value(c, v)}`);
    out.push({ kind: "update", row, sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE ${where}` });
  }
  changes.inserts.forEach((values, i) => {
    const given = values.flatMap((v, c) => (v === undefined ? [] : [c]));
    const sql = given.length
      ? `INSERT INTO ${table} (${given.map(name).join(", ")}) VALUES (${given
          .map((c) => value(c, values[c] ?? null))
          .join(", ")})`
      : dialect === "mysql"
        ? `INSERT INTO ${table} () VALUES ()`
        : `INSERT INTO ${table} DEFAULT VALUES`;
    out.push({ kind: "insert", row: set.rows.length + i, sql });
  });
  return out;
}

/** The WHERE of a row: each primary key column equal to its value. A NULL key cannot be matched. */
function keyOf(/** @type {Target} */ target, /** @type {(string | null)[]} */ row) {
  if (target.key.length === 0)
    throw new Error(`${target.name} has no primary key: edits are refused.`);
  return target.key
    .map((c) => {
      const column = target.columns[c];
      const v = row[c] ?? null;
      if (v === null)
        throw new Error(`This row's ${column?.name} is NULL, so it cannot be told apart.`);
      return `${qualified(target.dialect, "", column?.name ?? "")} = ${literal(target.dialect, v, column?.type ?? "")}`;
    })
    .join(" AND ");
}
