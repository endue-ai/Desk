// A PostgreSQL table's column types as the typed cell editors need them (PG-40): one catalog query
// per table that follows a domain to its base type and an array to its element, with the base's
// internal name and category (pg_type.typcategory), an enum's labels from pg_enum, NOT NULL and
// defaults (the domain's too), generated and identity columns, and the session's TimeZone. Built-in
// type OIDs map to the same name and category, for results that carry OIDs (PG-01c). Pure but for
// readTypes, which runs the query through the executor.

import { quoteText } from "../sql/quote.js";
import { parseArray } from "./pg-array.js";

/**
 * @typedef {{ typname: string, category: string }} BaseType
 * @typedef {BaseType & { element?: BaseType }} BuiltinType
 * @typedef {{
 *   type: string, typname: string, category: string, element: BaseType | null, labels: string[],
 *   nullable: boolean, hasDefault: boolean, generated: string, identity: string, timeZone: string,
 * }} TypeInfo
 *   `type` as the catalog writes it (format_type); `generated` is pg_attribute.attgenerated
 *   ("s" stored, "v" virtual) and `identity` attidentity ("a" always, "d" by default), "" for none.
 * @typedef {import("../catalog.js").Execute} Execute
 * @typedef {import("../engines/common.js").Connection} Connection
 */

/** The query of a table's column types, one row per column in the order of TypeInfo. */
export function typesSql(/** @type {string} */ schema, /** @type {string} */ table) {
  const where =
    `n.nspname = ${quoteText("postgresql", schema)} AND c.relname = ${quoteText("postgresql", table)} ` +
    "AND a.attnum > 0 AND NOT a.attisdropped";
  const from =
    "FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid " +
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace";
  return (
    "WITH RECURSIVE d (attnum, oid, depth, not_null, has_def) AS (" +
    `SELECT a.attnum, a.atttypid, 0, false, false ${from} WHERE ${where} ` +
    "UNION ALL SELECT d.attnum, t.typbasetype, d.depth + 1, d.not_null OR t.typnotnull, " +
    "d.has_def OR t.typdefaultbin IS NOT NULL FROM d JOIN pg_catalog.pg_type t ON t.oid = d.oid " +
    "WHERE t.typtype = 'd') " +
    "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), b.typname, b.typcategory, " +
    "coalesce(e.typname, ''), coalesce(e.typcategory, ''), " +
    "ARRAY(SELECT l.enumlabel::text FROM pg_catalog.pg_enum l WHERE l.enumtypid = " +
    "CASE WHEN b.typtype = 'e' THEN b.oid ELSE e.oid END ORDER BY l.enumsortorder)::text, " +
    "CASE WHEN a.attnotnull OR base.not_null THEN 'NO' ELSE 'YES' END, " +
    "CASE WHEN a.atthasdef OR a.attidentity <> '' OR base.has_def THEN 'YES' ELSE 'NO' END, " +
    "a.attgenerated::text, a.attidentity::text, pg_catalog.current_setting('TimeZone') " +
    `${from} JOIN LATERAL (SELECT d.oid, d.not_null, d.has_def FROM d WHERE d.attnum = a.attnum ` +
    "ORDER BY d.depth DESC LIMIT 1) base ON true JOIN pg_catalog.pg_type b ON b.oid = base.oid " +
    "LEFT JOIN pg_catalog.pg_type e0 ON b.typcategory = 'A' AND e0.oid = b.typelem " +
    "LEFT JOIN pg_catalog.pg_type e ON e.oid = CASE WHEN e0.typtype = 'd' THEN e0.typbasetype ELSE e0.oid END " +
    `WHERE ${where} ORDER BY a.attnum`
  );
}

/**
 * The query's rows as types by column name.
 * @param {(string | null)[][]} rows
 * @returns {Map<string, TypeInfo>}
 */
export function typesOf(rows) {
  /** @type {Map<string, TypeInfo>} */
  const types = new Map();
  for (const row of rows) {
    const [name, type, typname, category, element, elementCategory, labels] = row;
    const parsed = parseArray(labels ?? "{}");
    types.set(name ?? "", {
      type: type ?? "",
      typname: typname ?? "",
      category: category ?? "",
      element: element ? { typname: element, category: elementCategory ?? "" } : null,
      labels: "elements" in parsed ? parsed.elements.map((l) => l ?? "") : [],
      nullable: row[7] !== "NO",
      hasDefault: row[8] === "YES",
      generated: row[9] ?? "",
      identity: row[10] ?? "",
      timeZone: row[11] ?? "",
    });
  }
  return types;
}

/**
 * A table's column types, read through the executor (its catalog run asks nothing of the person).
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {string} schema
 * @param {string} table
 */
export async function readTypes(execute, conn, schema, table) {
  const run = await execute(conn, typesSql(schema, table), { catalog: true, maxRows: 2000 });
  const statement = run.result.statements[0];
  const error = run.result.error ?? statement?.error;
  if (error) throw new Error(error.message);
  return typesOf(statement?.sets[0]?.rows ?? []);
}

/** Built-in types by OID (pg_type.dat; fixed across versions): name, category, element. */
const BUILTIN = /** @type {Record<number, [string, string, number?]>} */ ({
  16: ["bool", "B"],
  17: ["bytea", "U"],
  20: ["int8", "N"],
  21: ["int2", "N"],
  23: ["int4", "N"],
  25: ["text", "S"],
  114: ["json", "U"],
  700: ["float4", "N"],
  701: ["float8", "N"],
  1043: ["varchar", "S"],
  1082: ["date", "D"],
  1083: ["time", "D"],
  1114: ["timestamp", "D"],
  1184: ["timestamptz", "D"],
  1186: ["interval", "T"],
  1266: ["timetz", "D"],
  1700: ["numeric", "N"],
  2950: ["uuid", "U"],
  3802: ["jsonb", "U"],
  1000: ["_bool", "A", 16],
  1001: ["_bytea", "A", 17],
  1005: ["_int2", "A", 21],
  1007: ["_int4", "A", 23],
  1009: ["_text", "A", 25],
  1015: ["_varchar", "A", 1043],
  1016: ["_int8", "A", 20],
  1021: ["_float4", "A", 700],
  1022: ["_float8", "A", 701],
  1182: ["_date", "A", 1082],
  1185: ["_timestamptz", "A", 1184],
  1231: ["_numeric", "A", 1700],
  2951: ["_uuid", "A", 2950],
  3807: ["_jsonb", "A", 3802],
});

/** A built-in type by its OID, as the resolver takes it; undefined for any other. */
export function builtinType(/** @type {number} */ oid) {
  const found = BUILTIN[oid];
  if (!found) return undefined;
  const [typname, category, element] = found;
  const inner = element === undefined ? undefined : BUILTIN[element];
  /** @type {BuiltinType} */
  const type = { typname, category };
  if (inner) type.element = { typname: inner[0], category: inner[1] };
  return type;
}
