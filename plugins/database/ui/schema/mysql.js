// MySQL's and MariaDB's objects from information_schema (DB-19): a database's tables (with the
// server's row estimate), views, MariaDB's sequences, procedures, functions and events; a table's
// keys, foreign keys, indexes and triggers. The DDL is the server's own SHOW CREATE; an index or a
// foreign key alone is written from the catalog. One query per kind, never a UNION of
// information_schema columns, whose collations differ between versions.

import { qualified, quoteName, quoteText } from "../sql/quote.js";
import { closeStatement } from "./common.js";

/**
 * @typedef {import("./common.js").SchemaObject} SchemaObject
 * @typedef {import("./common.js").Part} Part
 * @typedef {(string | null)[][]} Rows
 */

const q = (/** @type {string} */ value) => quoteText("mysql", value);
const n = (/** @type {string} */ name) => quoteName("mysql", name);

/** The queries of a database's objects; each answers name, kind, detail, row estimate, ident. */
export function objects(/** @type {string} */ schema) {
  return [
    "SELECT TABLE_NAME, CASE TABLE_TYPE WHEN 'VIEW' THEN 'view' WHEN 'SYSTEM VIEW' THEN 'view' " +
      "WHEN 'SEQUENCE' THEN 'sequence' ELSE 'table' END, COALESCE(ENGINE, ''), " +
      "CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN TABLE_ROWS END, '' FROM information_schema.TABLES " +
      `WHERE TABLE_SCHEMA = ${q(schema)} ORDER BY TABLE_NAME`,
    "SELECT ROUTINE_NAME, LOWER(ROUTINE_TYPE), COALESCE(DTD_IDENTIFIER, ''), NULL, '' " +
      `FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${q(schema)} ORDER BY ROUTINE_NAME`,
    "SELECT EVENT_NAME, 'event', COALESCE(STATUS, ''), NULL, '' FROM information_schema.EVENTS " +
      `WHERE EVENT_SCHEMA = ${q(schema)} ORDER BY EVENT_NAME`,
  ];
}

/** The queries of a table's parts; each answers kind, name, detail, extra. */
export function parts(/** @type {string} */ schema, /** @type {string} */ table) {
  const where = `TABLE_SCHEMA = ${q(schema)} AND TABLE_NAME = ${q(table)}`;
  return [
    "SELECT CASE CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 'primary key' WHEN 'UNIQUE' THEN 'unique' " +
      "WHEN 'CHECK' THEN 'check' ELSE 'constraint' END, CONSTRAINT_NAME, '', '' FROM " +
      `information_schema.TABLE_CONSTRAINTS WHERE ${where} AND CONSTRAINT_TYPE <> 'FOREIGN KEY' ` +
      "ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME",
    "SELECT 'foreign key', k.CONSTRAINT_NAME, CONCAT('(', GROUP_CONCAT(k.COLUMN_NAME ORDER BY " +
      "k.ORDINAL_POSITION SEPARATOR ', '), ') REFERENCES ', k.REFERENCED_TABLE_NAME, ' (', " +
      "GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ', '), ') ON UPDATE ', " +
      "MIN(r.UPDATE_RULE), ' ON DELETE ', MIN(r.DELETE_RULE)), CONCAT(k.REFERENCED_TABLE_SCHEMA, '.', " +
      "k.REFERENCED_TABLE_NAME) FROM information_schema.KEY_COLUMN_USAGE k JOIN " +
      "information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA " +
      "AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE " +
      `k.TABLE_SCHEMA = ${q(schema)} AND k.TABLE_NAME = ${q(table)} AND k.REFERENCED_TABLE_NAME IS NOT NULL ` +
      "GROUP BY k.CONSTRAINT_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME ORDER BY 2",
    "SELECT 'index', INDEX_NAME, CONCAT(CASE WHEN MIN(NON_UNIQUE) = 0 THEN 'UNIQUE ' ELSE '' END, " +
      "'(', GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', '), ') ', MIN(INDEX_TYPE)), '' " +
      `FROM information_schema.STATISTICS WHERE ${where} GROUP BY INDEX_NAME ORDER BY INDEX_NAME`,
    "SELECT 'trigger', TRIGGER_NAME, CONCAT(ACTION_TIMING, ' ', EVENT_MANIPULATION), '' FROM " +
      `information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA = ${q(schema)} AND EVENT_OBJECT_TABLE = ${q(table)} ` +
      "ORDER BY TRIGGER_NAME",
  ];
}

const SHOW = /** @type {Record<string, string>} */ ({
  table: "TABLE",
  view: "VIEW",
  sequence: "SEQUENCE",
  procedure: "PROCEDURE",
  function: "FUNCTION",
  event: "EVENT",
  trigger: "TRIGGER",
});

/** The SHOW CREATE an object's DDL needs. */
export function ddlQueries(/** @type {SchemaObject | Part} */ object) {
  if ("table" in object && object.kind !== "trigger") return [];
  const what = SHOW[object.kind];
  if (!what) return [];
  return [`SHOW CREATE ${what} ${qualified("mysql", object.schema, object.name)}`];
}

/**
 * The DDL from SHOW CREATE's result (the column named "Create ..." or "SQL Original Statement"),
 * or, for an index or a key, from its catalog definition.
 * @param {SchemaObject | Part} object
 * @param {Rows[]} results
 * @param {string[][]} [columns] Each result's column names.
 */
export function ddl(object, results, columns = []) {
  if ("table" in object && object.kind !== "trigger") return partDdl(object);
  const names = columns[0] ?? [];
  const at = names.findIndex((c) => /^Create /u.test(c) || c === "SQL Original Statement");
  const value = (results[0]?.[0] ?? [])[at >= 0 ? at : 1];
  if (value === null || value === undefined)
    return "-- The server shows no definition: you may lack the privilege to see it.\n";
  return closeStatement(value);
}

/** An index, a key or a foreign key of a table as its own statement. */
function partDdl(/** @type {Part} */ part) {
  const table = qualified("mysql", part.schema, part.table);
  if (part.kind === "index") {
    const unique = part.detail.startsWith("UNIQUE ");
    const columns = /\(([^)]*)\)/u.exec(part.detail)?.[1] ?? "";
    const list = columns
      .split(", ")
      .filter(Boolean)
      .map((c) => n(c))
      .join(", ");
    if (part.name === "PRIMARY") return `ALTER TABLE ${table} ADD PRIMARY KEY (${list});\n`;
    return `CREATE ${unique ? "UNIQUE " : ""}INDEX ${n(part.name)} ON ${table} (${list});\n`;
  }
  if (part.kind === "foreign key") {
    const match = /^\((.*)\) REFERENCES (.*) \((.*)\) ON UPDATE (.*) ON DELETE (.*)$/u.exec(
      part.detail,
    );
    if (!match) return `-- ${part.name}: ${part.detail}\n`;
    const cols = (/** @type {string} */ list) => list.split(", ").map(n).join(", ");
    const [, from = "", ref = "", to = "", update = "", del = ""] = match;
    const schema = part.extra.split(".")[0] ?? part.schema;
    return (
      `ALTER TABLE ${table} ADD CONSTRAINT ${n(part.name)} FOREIGN KEY (${cols(from)}) ` +
      `REFERENCES ${qualified("mysql", schema, ref)} (${cols(to)}) ON UPDATE ${update} ON DELETE ${del};\n`
    );
  }
  return `-- ${part.kind} ${part.name}: part of the table's DDL (SHOW CREATE TABLE).\n`;
}
