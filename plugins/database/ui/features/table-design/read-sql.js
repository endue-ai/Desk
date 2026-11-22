// What the table form reads of a PostgreSQL server (PG-51), in one catalog run: the server's version,
// its types (pg_catalog's and every user schema's; arrays by their element, table row types left
// out), its implicit and assignment casts, its roles and its index methods, and for an existing
// table its row (owner, comment, partition key), its columns (type, length, nullability, identity,
// generated, default, comment), its constraints (each with whether the form can write it) and the
// indexes no constraint owns (keys by column number or expression). Only the catalog. Pure.

import { qualified, quoteText } from "../../sql/quote.js";

/** @typedef {{ key: string, sql: string }} Read */

const PG = "postgresql";

/** The reads every form makes, a new table's or an existing one's. */
export const SERVER_READS = /** @type {Read[]} */ ([
  { key: "version", sql: "SELECT pg_catalog.current_setting('server_version_num') AS version" },
  {
    key: "types",
    sql:
      "SELECT t.oid::text, n.nspname, t.typname, pg_catalog.format_type(t.oid, NULL) AS formatted, " +
      "(t.typmodin <> 0)::text AS modifiable, t.typcategory::text, t.typbasetype::text " +
      "FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace " +
      "WHERE t.typtype IN ('b', 'c', 'd', 'e', 'm', 'r') AND t.typisdefined AND t.typcategory <> 'A' " +
      "AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_(toast|temp_)' AND (t.typrelid = 0 " +
      "OR EXISTS (SELECT FROM pg_catalog.pg_class r WHERE r.oid = t.typrelid AND r.relkind = 'c')) " +
      "ORDER BY n.nspname <> 'pg_catalog', n.nspname, 4",
  },
  {
    key: "casts",
    sql:
      "SELECT c.castsource::text, c.casttarget::text, c.castmethod::text FROM pg_catalog.pg_cast c " +
      "WHERE c.castcontext IN ('a', 'i')",
  },
  {
    key: "roles",
    sql: "SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY 1",
  },
  {
    key: "methods",
    sql: "SELECT a.amname FROM pg_catalog.pg_am a WHERE a.amtype = 'i' ORDER BY 1",
  },
]);

/** The reads of an existing table, after the server's. */
export function tableReads(/** @type {string} */ schema, /** @type {string} */ name) {
  const rel = `pg_catalog.to_regclass(${quoteText(PG, qualified(PG, schema, name))})`;
  return /** @type {Read[]} */ ([
    {
      key: "table",
      sql:
        "SELECT c.oid::text, c.relkind::text, pg_catalog.pg_get_userbyid(c.relowner) AS owner, " +
        "coalesce(pg_catalog.obj_description(c.oid, 'pg_class'), '') AS comment, " +
        "coalesce(pg_catalog.pg_get_partkeydef(c.oid), '') AS partition, c.relispartition::text " +
        `FROM pg_catalog.pg_class c WHERE c.oid = ${rel}`,
    },
    {
      key: "columns",
      sql:
        "SELECT a.attnum::text, a.attname, b.oid::text AS type, bn.nspname, b.typname, " +
        "pg_catalog.format_type(b.oid, NULL) AS formatted, (b.typmodin <> 0)::text AS modifiable, " +
        "b.typcategory::text, b.typbasetype::text, (e.oid IS NOT NULL)::text AS array, " +
        "CASE WHEN a.atttypmod >= 0 THEN coalesce(substring(pg_catalog.format_type(a.atttypid, " +
        "a.atttypmod) FROM '\\(([^)]*)\\)'), '') ELSE '' END AS length, a.attnotnull::text, " +
        "a.attidentity::text, a.attgenerated::text, " +
        "coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid, true), '') AS expression, " +
        "coalesce(pg_catalog.col_description(a.attrelid, a.attnum), '') AS comment " +
        "FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid = a.atttypid " +
        "LEFT JOIN pg_catalog.pg_type e ON t.typcategory = 'A' AND e.oid = t.typelem " +
        "JOIN pg_catalog.pg_type b ON b.oid = coalesce(e.oid, t.oid) " +
        "JOIN pg_catalog.pg_namespace bn ON bn.oid = b.typnamespace " +
        "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum " +
        `WHERE a.attrelid = ${rel} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
    },
    {
      key: "constraints",
      sql:
        "SELECT k.oid::text, k.contype::text, k.conname, " +
        "coalesce(pg_catalog.array_to_json(k.conkey)::text, '[]') AS columns, " +
        "coalesce(pg_catalog.pg_get_expr(k.conbin, k.conrelid, true), '') AS expression, " +
        "coalesce(fn.nspname, '') AS ref_schema, coalesce(fc.relname, '') AS ref_table, " +
        "coalesce((SELECT pg_catalog.json_agg(fa.attname ORDER BY u.i)::text FROM " +
        "pg_catalog.unnest(k.confkey) WITH ORDINALITY u(n, i) JOIN pg_catalog.pg_attribute fa " +
        "ON fa.attrelid = k.confrelid AND fa.attnum = u.n), '[]') AS ref_columns, " +
        "k.confdeltype::text, k.confupdtype::text, (k.condeferrable OR NOT k.convalidated OR " +
        "k.connoinherit OR NOT k.conislocal OR k.contype = 'x' OR (k.contype = 'f' AND " +
        "k.confmatchtype <> 's') OR (k.contype IN ('p', 'u') AND EXISTS (SELECT FROM " +
        "pg_catalog.pg_index i WHERE i.indexrelid = k.conindid AND (i.indnkeyatts < i.indnatts " +
        "OR i.indoption::text ~ '[1-9]'))) OR pg_catalog.pg_get_constraintdef(k.oid) ~ " +
        "'NULLS NOT DISTINCT|ON (DELETE|UPDATE) SET (NULL|DEFAULT) \\(')::text AS kept, " +
        "pg_catalog.pg_get_constraintdef(k.oid, true) AS definition, " +
        "(k.confrelid = k.conrelid)::text AS self " +
        "FROM pg_catalog.pg_constraint k LEFT JOIN pg_catalog.pg_class fc ON fc.oid = k.confrelid " +
        "LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace " +
        `WHERE k.conrelid = ${rel} AND k.contype IN ('p', 'u', 'c', 'f', 'x') ` +
        "ORDER BY k.contype, k.conname",
    },
    {
      key: "indexes",
      sql:
        "SELECT i.indexrelid::text, ic.relname, am.amname, i.indisunique::text, " +
        "(SELECT pg_catalog.json_agg(pg_catalog.json_build_array(u.n, CASE WHEN u.n = 0 THEN " +
        "pg_catalog.pg_get_indexdef(i.indexrelid, u.i::int, true) ELSE '' END) ORDER BY u.i)::text " +
        "FROM pg_catalog.unnest(i.indkey::int2[]) WITH ORDINALITY u(n, i) " +
        "WHERE u.i <= i.indnkeyatts) AS keys, " +
        "coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid, true), '') AS predicate, " +
        "(i.indnkeyatts < i.indnatts OR i.indoption::text ~ '[1-9]' OR ic.reloptions IS NOT NULL " +
        "OR ic.reltablespace <> 0 OR NOT i.indisvalid OR EXISTS (SELECT FROM " +
        "pg_catalog.unnest(i.indclass::oid[]) o(c) JOIN pg_catalog.pg_opclass oc ON oc.oid = o.c " +
        "WHERE NOT oc.opcdefault))::text AS kept, pg_catalog.pg_get_indexdef(i.indexrelid) AS " +
        "definition FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid " +
        "JOIN pg_catalog.pg_am am ON am.oid = ic.relam " +
        `WHERE i.indrelid = ${rel} AND NOT EXISTS (SELECT FROM pg_catalog.pg_constraint k ` +
        "WHERE k.conindid = i.indexrelid AND k.conrelid = i.indrelid " +
        "AND k.contype IN ('p', 'u', 'x')) ORDER BY ic.relname",
    },
  ]);
}
