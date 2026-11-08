// PostgreSQL's objects from pg_catalog (DB-19): a schema's tables, views, materialized views,
// foreign tables, sequences, functions and procedures (not an extension's), a table's keys,
// checks, foreign keys, indexes and triggers, and the DDL of each, written from the catalog the way
// pg_dump writes it: the server's own pg_get_*def where it has one. Every name and value is a
// quoted literal (quote.js); an oid is checked to be digits before it is written.

import { qualified, quoteName, quoteText } from "../sql/quote.js";
import { closeStatement, partsOf } from "./common.js";

/**
 * @typedef {import("./common.js").SchemaObject} SchemaObject
 * @typedef {import("./common.js").Part} Part
 * @typedef {(string | null)[][]} Rows
 */

const q = (/** @type {string} */ value) => quoteText("postgresql", value);
const inSchema = (/** @type {string} */ alias, /** @type {string} */ schema) =>
  `JOIN pg_catalog.pg_namespace n ON n.oid = ${alias}.relnamespace WHERE n.nspname = ${q(schema)}`;
const ofTable = (/** @type {string} */ schema, /** @type {string} */ table) =>
  `JOIN pg_catalog.pg_class c ON c.oid = %REL% JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${q(schema)} AND c.relname = ${q(table)}`;

/** The queries of a schema's objects; each answers name, kind, detail, row estimate, oid. */
export function objects(/** @type {string} */ schema) {
  return [
    "SELECT c.relname, CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' " +
      "WHEN 'f' THEN 'foreign table' WHEN 'S' THEN 'sequence' ELSE 'table' END, " +
      "CASE c.relkind WHEN 'p' THEN 'partitioned' ELSE '' END, " +
      "CASE WHEN c.relkind IN ('r', 'p', 'm') AND c.reltuples >= 0 THEN c.reltuples::bigint::text END, " +
      `c.oid::text FROM pg_catalog.pg_class c ${inSchema("c", schema)} ` +
      "AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND NOT c.relispartition ORDER BY c.relname",
    "SELECT p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', " +
      "CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, " +
      "coalesce(pg_catalog.pg_get_function_result(p.oid), ''), NULL, p.oid::text " +
      "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
      `WHERE n.nspname = ${q(schema)} AND p.prokind IN ('f', 'p') AND NOT EXISTS (SELECT 1 FROM ` +
      "pg_catalog.pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') ORDER BY 1",
  ];
}

/** The queries of a table's parts: constraints, indexes, triggers (kind, name, definition, flag). */
export function parts(/** @type {string} */ schema, /** @type {string} */ table) {
  const where = ofTable(schema, table);
  return [
    "SELECT CASE k.contype WHEN 'p' THEN 'primary key' WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check' " +
      "WHEN 'f' THEN 'foreign key' WHEN 'x' THEN 'exclusion' ELSE 'constraint' END, k.conname, " +
      "pg_catalog.pg_get_constraintdef(k.oid, true), CASE WHEN k.contype = 'f' THEN " +
      "k.confrelid::pg_catalog.regclass::text ELSE '' END FROM pg_catalog.pg_constraint k " +
      `${where.replace("%REL%", "k.conrelid")} ORDER BY 1, 2`,
    "SELECT 'index', i.relname, pg_catalog.pg_get_indexdef(i.oid), CASE WHEN EXISTS (SELECT 1 " +
      "FROM pg_catalog.pg_constraint k WHERE k.conindid = i.oid AND k.contype IN ('p', 'u', 'x')) " +
      "THEN 'constraint' ELSE '' END FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON " +
      `i.oid = x.indexrelid ${where.replace("%REL%", "x.indrelid")} ORDER BY 2`,
    "SELECT 'trigger', t.tgname, pg_catalog.pg_get_triggerdef(t.oid, true), '' FROM " +
      `pg_catalog.pg_trigger t ${where.replace("%REL%", "t.tgrelid")} AND NOT t.tgisinternal ORDER BY 2`,
  ];
}

/** The queries the DDL of an object needs; their rows go to `ddl` in the same order. */
export function ddlQueries(/** @type {SchemaObject | Part} */ object) {
  if ("table" in object) return [];
  const { schema, name } = object;
  const where = ofTable(schema, name);
  if (object.kind === "table" || object.kind === "foreign table")
    return [
      "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), " +
        "CASE WHEN a.attnotnull THEN 'YES' ELSE 'NO' END, pg_catalog.pg_get_expr(d.adbin, d.adrelid), " +
        "a.attidentity::text, a.attgenerated::text, pg_catalog.col_description(c.oid, a.attnum) " +
        "FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid " +
        `AND d.adnum = a.attnum ${where.replace("%REL%", "a.attrelid")} AND a.attnum > 0 ` +
        "AND NOT a.attisdropped ORDER BY a.attnum",
      ...parts(schema, name),
      "SELECT c.relkind::text, c.relpersistence::text, pg_catalog.obj_description(c.oid, 'pg_class'), " +
        "CASE WHEN c.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(c.oid) END, (SELECT s.srvname " +
        "FROM pg_catalog.pg_foreign_table f JOIN pg_catalog.pg_foreign_server s ON s.oid = f.ftserver " +
        `WHERE f.ftrelid = c.oid) FROM pg_catalog.pg_class c ${inSchema("c", schema)} AND c.relname = ${q(name)}`,
    ];
  if (object.kind === "view" || object.kind === "materialized view")
    return [
      `SELECT pg_catalog.pg_get_viewdef(c.oid, true) FROM pg_catalog.pg_class c ${inSchema("c", schema)} AND c.relname = ${q(name)}`,
      ...(object.kind === "materialized view" ? [parts(schema, name)[1] ?? ""] : []),
    ];
  if (object.kind === "sequence")
    return [
      "SELECT pg_catalog.format_type(s.seqtypid, NULL), s.seqstart::text, s.seqincrement::text, " +
        "s.seqmin::text, s.seqmax::text, s.seqcache::text, CASE WHEN s.seqcycle THEN 'YES' ELSE 'NO' END " +
        `FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid ${inSchema("c", schema)} AND c.relname = ${q(name)}`,
    ];
  if (object.kind === "function" || object.kind === "procedure") {
    if (!/^\d+$/u.test(object.ident)) throw new Error("This routine has no catalog id.");
    return [`SELECT pg_catalog.pg_get_functiondef(${object.ident}::oid)`];
  }
  return [];
}

/**
 * The DDL of an object from the rows of its queries, or of a part from its definition.
 * @param {SchemaObject | Part} object
 * @param {Rows[]} results
 */
export function ddl(object, results) {
  const name = qualified(
    "postgresql",
    object.schema,
    "table" in object ? object.table : object.name,
  );
  if ("table" in object) {
    if (object.kind === "index" || object.kind === "trigger") return closeStatement(object.detail);
    return closeStatement(
      `ALTER TABLE ${name} ADD CONSTRAINT ${quoteName("postgresql", object.name)} ${object.detail}`,
    );
  }
  const first = results[0] ?? [];
  if (object.kind === "table" || object.kind === "foreign table") return tableDdl(object, results);
  if (object.kind === "view" || object.kind === "materialized view") {
    const body = (first[0]?.[0] ?? "").trim().replace(/;$/u, "");
    if (object.kind === "view") return `CREATE OR REPLACE VIEW ${name} AS\n${body};\n`;
    const indexes = (results[1] ?? []).map((row) => closeStatement(row[2] ?? ""));
    return [`CREATE MATERIALIZED VIEW ${name} AS\n${body}\nWITH DATA;\n`, ...indexes].join("\n");
  }
  if (object.kind === "sequence") {
    const [type, start, step, min, max, cache, cycle] = first[0] ?? [];
    return (
      `CREATE SEQUENCE ${name}\n    AS ${type}\n    INCREMENT BY ${step}\n    MINVALUE ${min}\n` +
      `    MAXVALUE ${max}\n    START WITH ${start}\n    CACHE ${cache}\n    ${cycle === "YES" ? "CYCLE" : "NO CYCLE"};\n`
    );
  }
  return closeStatement(first[0]?.[0] ?? "");
}

/** CREATE TABLE from the columns, the constraints, then indexes, triggers and comments. */
function tableDdl(/** @type {SchemaObject} */ object, /** @type {Rows[]} */ results) {
  const name = qualified("postgresql", object.schema, object.name);
  const [columns = [], constraints = [], indexes = [], triggers = [], meta = []] = results;
  const [relkind, persistence, comment, partition, server] = meta[0] ?? [];
  const lines = columns.map(([column, type, notNull, def, identity, generated]) => {
    let line = `    ${quoteName("postgresql", column ?? "")} ${type}`;
    if (identity === "a") line += " GENERATED ALWAYS AS IDENTITY";
    else if (identity === "d") line += " GENERATED BY DEFAULT AS IDENTITY";
    else if (generated === "s" && def) line += ` GENERATED ALWAYS AS (${def}) STORED`;
    else if (def) line += ` DEFAULT ${def}`;
    if (notNull === "YES") line += " NOT NULL";
    return line;
  });
  const order = ["primary key", "unique", "exclusion", "check", "foreign key", "constraint"];
  const keys = partsOf(constraints, object)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((k) => `    CONSTRAINT ${quoteName("postgresql", k.name)} ${k.detail}`);
  const kind =
    relkind === "f"
      ? "FOREIGN TABLE"
      : `${persistence === "u" ? "UNLOGGED " : persistence === "t" ? "TEMPORARY " : ""}TABLE`;
  const tail = `${partition ? ` PARTITION BY ${partition}` : ""}${server ? ` SERVER ${quoteName("postgresql", server)}` : ""}`;
  const out = [`CREATE ${kind} ${name} (\n${[...lines, ...keys].join(",\n")}\n)${tail};\n`];
  const own = indexes
    .filter((row) => row[3] !== "constraint")
    .map((row) => closeStatement(row[2] ?? ""));
  const fired = triggers.map((row) => closeStatement(row[2] ?? ""));
  const notes = [
    ...(comment ? [`COMMENT ON TABLE ${name} IS ${q(comment)};\n`] : []),
    ...columns
      .filter((row) => row[6])
      .map(
        (row) =>
          `COMMENT ON COLUMN ${name}.${quoteName("postgresql", row[0] ?? "")} IS ${q(row[6] ?? "")};\n`,
      ),
  ];
  return [out.join(""), ...own, ...fired, ...notes].join("\n");
}
