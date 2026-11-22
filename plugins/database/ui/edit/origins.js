// What a PostgreSQL result's columns come from (PG-45, ADR 0350): the tables the row description
// names, read fresh from pg_catalog by OID in one statement at the first edit (never the schema
// cache, which may be older than the table): each relation's schema, name, kind and what the server
// can change of it, its columns with their types, NOT NULL and defaults, the unique indexes that can
// key its rows (primary first) and the tables its foreign keys reference. Then the target
// (edit/origin-target.js) with each table's typed editors (cell-editors/). Pure but for
// readOrigins, which runs the reads through the executor as the plugin's own catalog reading.

import { readTypes } from "../cell-editors/pg-types.js";
import { attachEditors } from "../cell-editors/resolve.js";
import { originTarget } from "./origin-target.js";
import { readsOnly, repeatedNames } from "./source.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("../catalog.js").Execute} Execute
 * @typedef {import("./pending.js").Target} Target
 * @typedef {import("./origin-target.js").Relation} Relation
 */

/** The tables a result's columns name, in the order they first appear. */
export function originOids(/** @type {ResultSet} */ set) {
  return [...new Set((set.origins ?? []).map((o) => o.table).filter((t) => t > 0))];
}

/** Whether a result on this engine is mapped by its origins: PostgreSQL that names a table. */
export const byOrigins = (/** @type {Connection} */ conn, /** @type {ResultSet} */ set) =>
  conn.engine === "postgresql" && originOids(set).length > 0;

const KEY = "(i.indkey::pg_catalog.int2[])[0:i.indnkeyatts - 1]";

/** The statement that reads the relations of `oids`, one row each in Relation's order. */
export function originsSql(/** @type {number[]} */ oids) {
  const list = oids.map((o) => String(Math.trunc(o))).join(", ");
  const updatable = "pg_catalog.pg_relation_is_updatable(c.oid::pg_catalog.regclass, false)";
  const columns =
    "(SELECT pg_catalog.json_agg(pg_catalog.json_build_array(a.attnum, a.attname, " +
    "pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, " +
    "pg_catalog.pg_get_expr(d.adbin, d.adrelid), " +
    "pg_catalog.pg_column_is_updatable(c.oid::pg_catalog.regclass, a.attnum, false)) ORDER BY a.attnum) " +
    "FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid " +
    "AND d.adnum = a.attnum WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)";
  const keys =
    "(SELECT pg_catalog.json_agg(pg_catalog.json_build_array(i.indisprimary, x.relname, " +
    `${KEY}) ORDER BY i.indisprimary DESC, i.indnkeyatts, x.relname) ` +
    "FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class x ON x.oid = i.indexrelid " +
    "WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL " +
    "AND i.indexprs IS NULL AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute k " +
    `WHERE k.attrelid = c.oid AND k.attnum = ANY (${KEY}) AND NOT k.attnotnull))`;
  const references =
    "(SELECT pg_catalog.json_agg(DISTINCT f.confrelid) FROM pg_catalog.pg_constraint f " +
    "WHERE f.conrelid = c.oid AND f.contype = 'f')";
  return (
    `SELECT c.oid, n.nspname, c.relname, c.relkind::text, ${updatable}, ${columns}, ${keys}, ` +
    `${references} FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace ` +
    `WHERE c.oid IN (${list || "0"}) ORDER BY c.oid`
  );
}

const json = (/** @type {string | null | undefined} */ text) => {
  if (!text) return [];
  const value = JSON.parse(text);
  return Array.isArray(value) ? value : [];
};

/**
 * The statement's rows as relations by OID.
 * @param {(string | null)[][]} rows
 * @returns {Map<number, Relation>}
 */
export function relationsOf(rows) {
  /** @type {Map<number, Relation>} */
  const out = new Map();
  for (const [oid, schema, name, relkind, updatable, columns, keys, references] of rows) {
    out.set(Number(oid), {
      oid: Number(oid),
      schema: schema ?? "",
      name: name ?? "",
      relkind: relkind ?? "",
      updatable: Number(updatable ?? 0),
      columns: json(columns).map(([attnum, n, type, notNull, given, can]) => ({
        attnum: Number(attnum),
        name: String(n),
        type: String(type),
        notNull: notNull === true,
        default: given ?? null,
        updatable: can !== false,
      })),
      keys: json(keys).map(([primary, n, cols]) => ({
        primary: primary === true,
        name: String(n),
        columns: (Array.isArray(cols) ? cols : []).map(Number),
      })),
      references: json(references).map(Number),
    });
  }
  return out;
}

/**
 * The edit target of a PostgreSQL result by its origins, with each table's typed editors.
 * @param {{ execute: Execute, conn: Connection, set: ResultSet, statement?: Statement }} input
 *   `statement` is the console's (it must only read); a table's view, which the plugin writes as
 *   one table's rows, passes none.
 * @returns {Promise<{ target?: Target, reason: string }>}
 */
export async function readOrigins({ execute, conn, set, statement }) {
  if (statement && !readsOnly(statement))
    return { reason: "Only a query that reads can have its rows changed: this one writes." };
  const run = await execute(conn, originsSql(originOids(set)), { catalog: true, maxRows: 1000 });
  const read = run.result.statements[0];
  const error = run.result.error ?? read?.error;
  if (error) return { reason: `The tables of this result could not be read: ${error.message}` };
  const relations = relationsOf(read?.sets[0]?.rows ?? []);
  const repeated = statement ? repeatedNames(statement, "postgresql") : () => false;
  let target = originTarget(set, relations, repeated);
  for (const [t, table] of (target.tables ?? []).entries()) {
    const rel = [...relations.values()].find(
      (r) => r.schema === table.schema && r.name === table.name,
    );
    if (!rel) continue;
    const types = await readTypes(execute, conn, table.schema, table.name).catch(() => new Map());
    const own = (/** @type {Target["columns"][number]} */ c) => c.known && c.table === t;
    const typed = attachEditors(
      { ...target, columns: target.columns.map((c) => (own(c) ? c : { ...c, known: false })) },
      rel.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: !c.notNull,
        default: c.default,
        primary: Boolean(rel.keys.find((k) => k.primary)?.columns.includes(c.attnum)),
        comment: "",
      })),
      types,
      set.types,
    );
    target = {
      ...target,
      columns: target.columns.map((c, i) => (own(c) ? (typed.columns[i] ?? c) : c)),
    };
  }
  return { target, reason: "" };
}
