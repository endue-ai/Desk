// Pending changes of a result mapped by its columns' origins (PG-45, ADR 0350): each cell belongs
// to one table of the result (edit/origin-target.js), so a row of a join changes as one UPDATE per
// table, each keyed on that table's own key; two rows of the join that change one row of a table
// are one statement, and two values for one of its cells are refused. Updates run parents first: a
// table another one of the result references by foreign key comes before it. A table keyed by
// ctid or by every column's value is written guarded: the statement must change exactly one row,
// else it fails and the whole Submit rolls back. Values are compared as the server writes them
// (their output text, pg_catalog.format). Rows of a join are neither added nor deleted. Pure.

import { literalFor } from "../cell-editors/values.js";
import { qualified, quoteText } from "../sql/quote.js";
import { t as messageText } from "../strings/index.js";
import { isDefault, literal } from "./values.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("./pending.js").Target} Target
 * @typedef {import("./pending.js").TargetTable} TargetTable
 * @typedef {import("./pending.js").Changes} Changes
 * @typedef {import("./pending.js").Change} Change
 * @typedef {import("./pending.js").Span} Span
 */

/** What a guarded statement's count says when it is not 1; submit.js reads it back. */
export const MATCHED = / rows matched"?$/u;
const HEAD = "WITH changed AS (";
const TAIL =
  " RETURNING 1) SELECT CASE WHEN pg_catalog.count(*) = 1 THEN 1 ELSE " +
  "(pg_catalog.count(*)::text || ' rows matched')::int END FROM changed";

/** A table of the target by its index, or throws. */
const tableAt = (/** @type {Target} */ target, /** @type {number | undefined} */ t) => {
  const table = target.tables?.[t ?? -1];
  if (!table) throw new Error(messageText("edit.tables.thisCellBelongsToNoTable"));
  return table;
};

/** The qualified name of a table of the target. */
const nameOf = (/** @type {Target} */ target, /** @type {TargetTable} */ table) =>
  qualified(target.dialect, table.schema, table.name);

/**
 * The WHERE that finds a result row's row of one table: its key's values, or for a guarded key its
 * ctid and every one of its columns in the result, compared as the server writes them. Throws when
 * a key value is NULL (an outer join's missing row, or a NULL in the key).
 * @param {Target} target
 * @param {number} t
 * @param {(string | null)[]} row
 */
export function whereOf(target, t, row) {
  const table = tableAt(target, t);
  const q = (/** @type {number} */ c) =>
    qualified(target.dialect, "", target.columns[c]?.name ?? "");
  const parts = table.key.map((c) => {
    const column = target.columns[c];
    const v = row[c] ?? null;
    if (v === null)
      throw new Error(
        messageText("edit.tables.thisRowSOfIsNull", {
          value: String(column?.name ?? messageText("edit.tables.key")),
          name: String(table.name),
          name2: String(table.name),
        }),
      );
    if (table.by === "ctid") return `ctid = ${quoteText(target.dialect, v)}::pg_catalog.tid`;
    return `${q(c)} = ${literal(target.dialect, v, column?.type ?? "")}`;
  });
  for (const c of table.match) {
    const v = row[c] ?? null;
    parts.push(
      v === null
        ? `${q(c)} IS NULL`
        : `pg_catalog.format('%s', ${q(c)}) = ${quoteText(target.dialect, v)}`,
    );
  }
  return parts.join(" AND ");
}

/** Why rows of the target cannot be added or deleted, or "" when they can. */
export function rowsRefusal(/** @type {Target} */ target, /** @type {"insert" | "delete"} */ kind) {
  const tables = target.tables ?? [];
  const verb = kind === "insert" ? "added" : "deleted";
  const read = target.joined ?? tables.map((t) => t.name);
  if (read.length > 1)
    return messageText("edit.tables.rowsOfAJoinOfCannot", {
      value: String(read.join(" and ")),
      verb: String(verb),
    });
  const [table] = tables;
  if (table && !table[kind])
    return messageText("edit.tables.takesNoRowsTheServerRefuses", {
      name: String(table.name),
      verb: String(verb),
    });
  return "";
}

/** A statement, guarded to change exactly one row when its table's key is not unique by itself. */
function statement(
  /** @type {TargetTable} */ table,
  /** @type {Omit<Change, "sql" | "cells">} */ head,
  /** @type {string} */ sql,
  /** @type {Span[]} */ cells,
) {
  if (table.by !== "ctid" && table.by !== "row") return { ...head, sql, cells };
  const moved = cells.map((s) => ({
    ...s,
    start: s.start + HEAD.length,
    end: s.end + HEAD.length,
  }));
  return { ...head, sql: `${HEAD}${sql}${TAIL}`, cells: moved, guarded: table.name };
}

/**
 * The statements of a target with tables: deletes, updates (parents first, then by row), inserts.
 * @param {Target} target
 * @param {ResultSet} set
 * @param {Changes} changes
 * @returns {Change[]}
 */
export function planTables(target, set, changes) {
  const { dialect } = target;
  const name = (/** @type {number} */ c) => qualified(dialect, "", target.columns[c]?.name ?? "");
  const value = (/** @type {number} */ c, /** @type {string | null} */ v) => {
    const column = target.columns[c];
    return literalFor(dialect, v, column?.editor, column?.type ?? "");
  };
  const original = (/** @type {number} */ row) =>
    /** @type {(string | null)[]} */ (set.rows[row] ?? []);
  /** @type {Change[]} */
  const out = [];
  for (const row of [...changes.deletes].sort((a, b) => a - b)) {
    const table = tableAt(target, 0);
    const sql = `DELETE FROM ${nameOf(target, table)} WHERE ${whereOf(target, 0, original(row))}`;
    out.push(statement(table, { kind: "delete", row }, sql, []));
  }
  /** @type {Map<string, { t: number, row: number, where: string, cells: Map<number, [string | null, number]> }>} */
  const merged = new Map();
  for (const [row, cells] of [...changes.updates].sort(([a], [b]) => a - b))
    for (const [c, v] of cells) {
      const t = target.columns[c]?.table ?? 0;
      const where = whereOf(target, t, original(row));
      const id = `${t}\u0000${where}`;
      const entry = merged.get(id) ?? { t, row, where, cells: new Map() };
      merged.set(id, entry);
      const before = entry.cells.get(c);
      if (before && before[0] !== v) {
        const table = tableAt(target, t);
        throw new Error(
          messageText("edit.tables.rowsAndAreOneRowOf", {
            value: String(before[1] + 1),
            value2: String(row + 1),
            name: String(table.name),
            value3: String(target.columns[c]?.name),
          }),
        );
      }
      entry.cells.set(c, [v, before?.[1] ?? row]);
    }
  const rank = (/** @type {number} */ t) => target.tables?.[t]?.rank ?? 0;
  const updates = [...merged.values()].sort((a, b) => rank(a.t) - rank(b.t) || a.row - b.row);
  for (const { t, row, where, cells } of updates) {
    const table = tableAt(target, t);
    const spans = /** @type {Span[]} */ ([]);
    let sql = `UPDATE ${nameOf(target, table)} SET `;
    [...cells]
      .sort(([a], [b]) => a - b)
      .forEach(([c, [v]], i) => {
        sql += `${i ? ", " : ""}${name(c)} = `;
        const text = value(c, v);
        spans.push({ col: c, start: sql.length, end: sql.length + text.length });
        sql += text;
      });
    out.push(statement(table, { kind: "update", row }, `${sql} WHERE ${where}`, spans));
  }
  changes.inserts.forEach((values, i) => {
    const table = tableAt(target, 0);
    const given = values.flatMap((v, c) => (v === undefined || isDefault(v) ? [] : [c]));
    const spans = /** @type {Span[]} */ ([]);
    let sql = `INSERT INTO ${nameOf(target, table)} (${given.map(name).join(", ")}) VALUES (`;
    given.forEach((c, n) => {
      sql += n ? ", " : "";
      const text = value(c, values[c] ?? null);
      spans.push({ col: c, start: sql.length, end: sql.length + text.length });
      sql += text;
    });
    sql = given.length ? `${sql})` : `INSERT INTO ${nameOf(target, table)} DEFAULT VALUES`;
    out.push({ kind: "insert", row: set.rows.length + i, sql, cells: spans });
  });
  return out;
}
