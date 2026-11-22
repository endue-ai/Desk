// What the comparison reads of one PostgreSQL schema (PG-53): the server's facts and every table's
// columns, constraints and indexes as the table form reads one (features/table-design/read-sql.js),
// and the schema's views and materialized views (their queries), sequences (not an identity's),
// functions and procedures (pg_get_functiondef), enum, domain and composite types, and triggers (not
// the server's own). An extension's objects are left out. Each statement opens with a comment naming
// its read. Only the catalog. Pure.

import { quoteText } from "../../sql/quote.js";
import { SERVER_READS, schemaTableReads } from "../table-design/read-sql.js";

/** @typedef {{ key: string, sql: string }} Read */

/** `NOT` an extension's member of a catalog. */
const mine = (/** @type {string} */ catalog, /** @type {string} */ oid) =>
  `NOT EXISTS (SELECT FROM pg_catalog.pg_depend x WHERE x.classid = 'pg_catalog.${catalog}'::regclass AND x.objid = ${oid} AND x.deptype = 'e')`;

/** The reads of a schema, in the order they run. */
export function schemaReads(/** @type {string} */ schema) {
  const ns = `(SELECT n.oid FROM pg_catalog.pg_namespace n WHERE n.nspname = ${quoteText("postgresql", schema)})`;
  /** @type {Read[]} */
  const own = [
    {
      key: "tables",
      sql:
        "SELECT c.oid::text, c.relname FROM pg_catalog.pg_class c " +
        `WHERE c.relnamespace = ${ns} AND c.relkind IN ('r', 'p') AND NOT c.relispartition ` +
        `AND ${mine("pg_class", "c.oid")} ORDER BY 2`,
    },
    {
      key: "views",
      sql:
        "SELECT c.relname, c.relkind::text, pg_catalog.pg_get_viewdef(c.oid, true) FROM " +
        `pg_catalog.pg_class c WHERE c.relnamespace = ${ns} AND c.relkind IN ('v', 'm') ` +
        `AND ${mine("pg_class", "c.oid")} ORDER BY 1`,
    },
    {
      key: "sequences",
      sql:
        "SELECT c.relname, pg_catalog.format_type(s.seqtypid, NULL), s.seqstart::text, " +
        "s.seqincrement::text, s.seqmin::text, s.seqmax::text, s.seqcache::text, s.seqcycle::text " +
        "FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid " +
        `WHERE c.relnamespace = ${ns} AND NOT EXISTS (SELECT FROM pg_catalog.pg_depend d WHERE ` +
        "d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('i', 'e')) " +
        "ORDER BY 1",
    },
    {
      key: "routines",
      sql:
        "SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), p.prokind::text, " +
        "pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p " +
        `WHERE p.pronamespace = ${ns} AND p.prokind IN ('f', 'p') AND ${mine("pg_proc", "p.oid")} ` +
        "ORDER BY 1, 2",
    },
    {
      key: "types",
      sql:
        "SELECT t.typname, t.typtype::text, CASE t.typtype WHEN 'e' THEN (SELECT " +
        "pg_catalog.json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e " +
        "WHERE e.enumtypid = t.oid)::text WHEN 'c' THEN (SELECT pg_catalog.json_agg(" +
        "pg_catalog.json_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)) " +
        "ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = t.typrelid AND " +
        "a.attnum > 0 AND NOT a.attisdropped)::text ELSE pg_catalog.format_type(t.typbasetype, " +
        "t.typtypmod) END, coalesce(t.typdefault, ''), t.typnotnull::text, coalesce((SELECT " +
        "pg_catalog.json_agg(pg_catalog.json_build_array(k.conname, " +
        "pg_catalog.pg_get_constraintdef(k.oid, true)) ORDER BY k.conname) FROM " +
        "pg_catalog.pg_constraint k WHERE k.contypid = t.oid AND k.contype = 'c')::text, '[]') " +
        "FROM pg_catalog.pg_type t LEFT JOIN pg_catalog.pg_class r ON r.oid = t.typrelid " +
        `WHERE t.typnamespace = ${ns} AND (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND ` +
        `r.relkind = 'c')) AND ${mine("pg_type", "t.oid")} ORDER BY 1`,
    },
    {
      key: "triggers",
      sql:
        "SELECT c.relname, t.tgname, pg_catalog.pg_get_triggerdef(t.oid, true) FROM " +
        "pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid " +
        `WHERE c.relnamespace = ${ns} AND NOT t.tgisinternal ORDER BY 1, 2`,
    },
  ];
  const tables = schemaTableReads(schema).map((r) => ({ key: `table.${r.key}`, sql: r.sql }));
  return [
    ...SERVER_READS.map((r) => ({ key: `server.${r.key}`, sql: r.sql })),
    ...own,
    ...tables,
  ].map((r) => ({ key: r.key, sql: `/* schema-compare ${r.key} */ ${r.sql}` }));
}
