// SQLite's objects from sqlite_master and its pragmas (DB-19): tables and views, a table's primary
// key, unique constraints, foreign keys, indexes and triggers. SQLite keeps the CREATE statement of
// each object as it was written, so the DDL is that text; a table's DDL brings its indexes and
// triggers along. There are no sequences or routines to show.

import { quoteName, quoteText } from "../sql/quote.js";
import { closeStatement } from "./common.js";

/**
 * @typedef {import("./common.js").SchemaObject} SchemaObject
 * @typedef {import("./common.js").Part} Part
 * @typedef {(string | null)[][]} Rows
 */

const q = (/** @type {string} */ value) => quoteText("sqlite", value);

/** The queries of the objects; each answers name, kind, detail, row estimate, ident. */
export function objects(/** @type {string} */ _schema) {
  return [
    "SELECT name, type, CASE WHEN sql LIKE '%WITHOUT ROWID%' THEN 'without rowid' ELSE '' END, " +
      "NULL, '' FROM sqlite_master WHERE type IN ('table', 'view') " +
      "AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name",
  ];
}

/** The queries of a table's parts; each answers kind, name, detail, extra. */
export function parts(/** @type {string} */ _schema, /** @type {string} */ table) {
  const t = q(table);
  return [
    "SELECT 'primary key', 'PRIMARY KEY', '(' || group_concat(name, ', ') || ')', '' FROM " +
      `(SELECT name FROM pragma_table_info(${t}) WHERE pk > 0 ORDER BY pk) HAVING count(*) > 0`,
    "SELECT 'foreign key', 'fk' || id, '(' || group_concat(\"from\", ', ') || ') REFERENCES ' || " +
      "\"table\" || ' (' || group_concat(coalesce(\"to\", ''), ', ') || ') ON UPDATE ' || " +
      `on_update || ' ON DELETE ' || on_delete, "table" FROM (SELECT * FROM ` +
      `pragma_foreign_key_list(${t}) ORDER BY id, seq) GROUP BY id ORDER BY id`,
    "SELECT CASE WHEN i.origin = 'u' THEN 'unique' ELSE 'index' END, i.name, coalesce(m.sql, " +
      "CASE i.origin WHEN 'pk' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END), CASE WHEN m.sql IS NULL " +
      `THEN 'constraint' ELSE '' END FROM pragma_index_list(${t}) i LEFT JOIN sqlite_master m ` +
      "ON m.type = 'index' AND m.name = i.name ORDER BY i.name",
    "SELECT 'trigger', name, sql, '' FROM sqlite_master WHERE type = 'trigger' " +
      `AND tbl_name = ${t} ORDER BY name`,
  ];
}

/** The query an object's DDL needs: its own CREATE, and for a table its indexes and triggers. */
export function ddlQueries(/** @type {SchemaObject | Part} */ object) {
  if ("table" in object) return [];
  const where =
    object.kind === "table"
      ? `tbl_name = ${q(object.name)} ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`
      : `name = ${q(object.name)}`;
  return [`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND ${where}`];
}

/**
 * The DDL: the CREATE statements SQLite kept, each closed with `;`.
 * @param {SchemaObject | Part} object
 * @param {Rows[]} results
 */
export function ddl(object, results) {
  if ("table" in object) {
    const table = quoteName("sqlite", object.table);
    if ((object.kind === "index" || object.kind === "trigger") && object.extra !== "constraint")
      return closeStatement(object.detail);
    return `-- ${object.kind} ${object.name} of ${table}: ${object.detail}\n-- It is part of the table's CREATE TABLE.\n`;
  }
  const statements = (results[0] ?? []).map((row) => closeStatement(row[0] ?? ""));
  return statements.length ? statements.join("\n") : `-- ${object.name} has no DDL.\n`;
}
