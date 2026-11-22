// What a copy reads before it runs (PG-63), each as the plugin's own catalog read (`catalog: true`,
// on a short session): a source table's definition (the catalog queries of schema/postgres.js and
// its foreign keys with the tables they reference), a server's version, which types and tables the
// target has and an existing table's columns, and the columns a query answers (a check, which
// runs nothing). No DOM.

import { ddlQueries } from "../schema/postgres.js";
import { quoteText } from "../sql/quote.js";
import { keyOf } from "./ddl.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../catalog.js").Execute} Execute
 * @typedef {import("./ddl.js").TableDef} TableDef
 * @typedef {import("./ddl.js").Name} Name
 * @typedef {{ name: string, type: string, generated: boolean }} Column
 * @typedef {{ number: number, text: string }} Version
 * @typedef {{ version: Version, missing: string[], schemas: string[], tables: Map<string, Column[]> }} TargetFacts
 *   `missing` the types asked for that the server does not know; `schemas` those asked for that it
 *   has; `tables` the asked tables it has (by keyOf), with their columns.
 */

const q = (/** @type {string} */ s) => quoteText("postgresql", s);
const list = (/** @type {string[]} */ values) =>
  `ARRAY[${values.map(q).join(", ") || "NULL"}]::text[]`;

/** The message a run failed with, or "". */
export function failureOf(/** @type {import("../execute.js").Execution} */ execution) {
  const result = execution.result;
  const error = result.error ?? result.statements.find((s) => s.error)?.error;
  return error ? error.message : "";
}

/** Each statement's rows of one catalog run; a failure throws its message. */
async function read(
  /** @type {Execute} */ execute,
  /** @type {Connection} */ conn,
  /** @type {string[]} */ queries,
) {
  const execution = await execute(conn, queries.join(";\n"), { catalog: true });
  const failed = failureOf(execution);
  if (failed) throw new Error(`${conn.name}: ${failed}`);
  return execution.result.statements.map((s) => s.sets[0]?.rows ?? []);
}

/** The foreign keys of a table, with the schema and name of each table they reference. */
export function foreignKeysSql(/** @type {string} */ schema, /** @type {string} */ table) {
  return (
    "SELECT k.conname, pg_catalog.pg_get_constraintdef(k.oid, true), rn.nspname, rc.relname, " +
    "k.confrelid::pg_catalog.regclass::text FROM pg_catalog.pg_constraint k " +
    "JOIN pg_catalog.pg_class c ON c.oid = k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
    "JOIN pg_catalog.pg_class rc ON rc.oid = k.confrelid JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace " +
    `WHERE k.contype = 'f' AND n.nspname = ${q(schema)} AND c.relname = ${q(table)} ORDER BY k.conname`
  );
}

/**
 * A source table's definition.
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {Name} table
 * @returns {Promise<TableDef>}
 */
export async function readTable(execute, conn, table) {
  const object = { ...table, kind: "table", detail: "", rows: null, ident: "" };
  const queries = ddlQueries(/** @type {any} */ (object));
  const [columns = [], constraints = [], indexes = [], triggers = [], meta = [], keys = []] =
    await read(execute, conn, [...queries, foreignKeysSql(table.schema, table.name)]);
  if (meta.length === 0)
    throw new Error(`${conn.name} has no table ${table.schema}.${table.name}.`);
  return {
    ...table,
    columns,
    constraints: constraints.filter((row) => row[0] !== "foreign key"),
    indexes,
    triggers,
    meta,
    keys: keys.map(([name, definition, schema, referenced, shown]) => ({
      name: name ?? "",
      definition: definition ?? "",
      schema: schema ?? "",
      table: referenced ?? "",
      shown: shown ?? "",
    })),
  };
}

const VERSION_SQL =
  "SELECT current_setting('server_version_num'), current_setting('server_version')";

/** A server's version, as a number (170002) and as it says it (17.2). @returns {Version} */
function versionOf(/** @type {(string | null)[][]} */ rows) {
  const [number, text] = rows[0] ?? [];
  return { number: Number(number ?? 0), text: (text ?? "").split(" ")[0] ?? "" };
}

/** A server's version. */
export async function readVersion(/** @type {Execute} */ execute, /** @type {Connection} */ conn) {
  const [rows = []] = await read(execute, conn, [VERSION_SQL]);
  return versionOf(rows);
}

/**
 * What the target has of what a copy needs.
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {{ types: string[], schemas: string[], tables: Name[] }} wanted
 * @returns {Promise<TargetFacts>}
 */
export async function readTarget(execute, conn, wanted) {
  const pairs = wanted.tables.map((t) => `(${q(t.schema)}, ${q(t.name)})`).join(", ");
  const [types = [], schemas = [], columns = [], versions = []] = await read(execute, conn, [
    `SELECT t FROM unnest(${list(wanted.types)}) t WHERE t IS NOT NULL AND pg_catalog.to_regtype(t) IS NULL`,
    `SELECT n.nspname FROM pg_catalog.pg_namespace n WHERE n.nspname = ANY(${list(wanted.schemas)})`,
    "SELECT n.nspname, c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), " +
      "a.attgenerated::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON " +
      "n.oid = c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 " +
      "AND NOT a.attisdropped WHERE c.relkind IN ('r', 'p') AND " +
      `(n.nspname, c.relname) IN (${pairs || "(NULL, NULL)"}) ORDER BY 1, 2, a.attnum`,
    VERSION_SQL,
  ]);
  /** @type {Map<string, Column[]>} */
  const tables = new Map();
  for (const [schema, table, name, type, generated] of columns) {
    const key = keyOf(schema ?? "", table ?? "");
    const held = tables.get(key) ?? [];
    held.push({ name: name ?? "", type: type ?? "", generated: (generated ?? "") !== "" });
    tables.set(key, held);
  }
  return {
    version: versionOf(versions),
    missing: types.map((row) => row[0] ?? ""),
    schemas: schemas.map((row) => row[0] ?? ""),
    tables,
  };
}

/**
 * The columns a query answers and their types, from a check that runs nothing.
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {string} sql
 * @returns {Promise<{ name: string, type: string }[]>}
 */
export async function describeQuery(execute, conn, sql) {
  const execution = await execute(conn, sql, { mode: "describe", catalog: true });
  const failed = failureOf(execution);
  if (failed) throw new Error(failed);
  const outcome = /** @type {{ described?: import("../engines/pg-describe.js").Described }} */ (
    execution.result.statements[0]
  );
  const columns = outcome?.described?.columns;
  if (!columns?.length) throw new Error("The statement answers no rows: copy a query's result.");
  return columns.map((c) => ({ name: c.name, type: c.type }));
}
