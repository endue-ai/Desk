// What the schema cache reads of a PostgreSQL database, kind by kind: each kind is one statement
// for every schema of a pass (its first column the schema's name), and the marks it adds to the
// fingerprint statement, which counts each schema's catalog rows and sums their xmin. A DDL
// statement writes new row versions, so a schema's mark moves; ANALYZE and VACUUM update in place
// and move nothing. Only pg_catalog is read: names and definitions, never rows, never a routine's
// body. A kind is added by adding it to the list (PG-50, schema/pg/); its id changes `signature`,
// so what was kept before it is read again. A kind of the database level (extensions, roles ...)
// is read for the cache's entry DATABASE ("") and fingerprinted on a row of its own. Pure.

import { DATABASE, READERS } from "../schema/pg/index.js";
import { quoteText } from "../sql/quote.js";
import { t } from "../strings/index.js";

export { DATABASE };

/**
 * @typedef {{
 *   id: string, label: string, marks: string[], level?: "database",
 *   sql(schemas: string[], version?: number): string,
 * }} Kind
 *   `marks` are subqueries answering `ns` (a namespace oid), `c` (rows) and `x` (their xmin
 *   summed), or for the database level one text each; `sql` answers the schema's name ("" for the
 *   database level), then the kind's own columns (model.js reads them), as the server's version
 *   (`server_version_num`) has them.
 */

const sum = (/** @type {string} */ alias) => `pg_catalog.sum(${alias}.xmin::text::bigint)`;
const viaClass = (/** @type {string} */ from, /** @type {string} */ alias, on = "") =>
  `SELECT c.relnamespace AS ns, pg_catalog.count(*) AS c, ${sum(alias)} AS x FROM ${from} ` +
  `JOIN pg_catalog.pg_class c ON c.oid = ${on} GROUP BY 1`;
const comment = (/** @type {string} */ catalog, /** @type {string} */ oid, sub = "0") =>
  `LEFT JOIN pg_catalog.pg_description d ON d.objoid = ${oid} AND d.classoid = ` +
  `'pg_catalog.${catalog}'::pg_catalog.regclass AND d.objsubid = ${sub}`;
/** `n.nspname IN (...)`, every name a literal. */
export const inSchemas = (/** @type {string[]} */ schemas) =>
  `n.nspname IN (${schemas.map((s) => quoteText("postgresql", s)).join(", ")})`;
const ofRelations = (/** @type {string} */ on) =>
  `JOIN pg_catalog.pg_class c ON c.oid = ${on} JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace`;
const RELKINDS = "c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND NOT c.relispartition";
const COLUMN_OWNERS = "c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition";
const names = (/** @type {string} */ rel, /** @type {string} */ keys) =>
  `pg_catalog.to_json(ARRAY(SELECT a.attname FROM pg_catalog.unnest(${keys}) WITH ORDINALITY ` +
  `u(n, o) JOIN pg_catalog.pg_attribute a ON a.attrelid = ${rel} AND a.attnum = u.n ORDER BY u.o))::text`;

/**
 * Tables, views, materialized views, foreign tables, sequences: name, relkind, estimate, oid,
 * comment, row security ("on", "forced") and the size the server estimates (table, TOAST, indexes).
 */
const relations = {
  id: "relations",
  label: t("schemaCache.kinds.tablesAndViews"),
  marks: [
    `SELECT c.relnamespace AS ns, pg_catalog.count(*) AS c, ${sum("c")} AS x FROM pg_catalog.pg_class c GROUP BY 1`,
    viaClass(
      "pg_catalog.pg_description d",
      "d",
      "d.objoid AND d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass",
    ),
  ],
  sql: (/** @type {string[]} */ schemas) =>
    "SELECT n.nspname, c.relname, c.relkind::text, CASE WHEN c.relkind IN ('r', 'p', 'm') AND " +
    "c.reltuples >= 0 THEN c.reltuples::bigint::text END, c.oid::text, d.description, CASE WHEN " +
    "c.relforcerowsecurity THEN 'forced' WHEN c.relrowsecurity THEN 'on' END, CASE WHEN c.relkind IN " +
    "('r', 'm') AND c.reltuples >= 0 THEN ((c.relpages::bigint + coalesce((SELECT t.relpages FROM " +
    "pg_catalog.pg_class t WHERE t.oid = c.reltoastrelid), 0) + coalesce((SELECT pg_catalog.sum(" +
    "i.relpages) FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid WHERE " +
    "x.indrelid = c.oid), 0)) * pg_catalog.current_setting('block_size')::bigint)::text END FROM " +
    "pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
    `${comment("pg_class", "c.oid")} WHERE ${inSchemas(schemas)} AND ${RELKINDS} ORDER BY 1, 2`,
};

/** Every column: table, name, type, flags (n not null, p in the primary key), default, comment. */
const columns = {
  id: "columns",
  label: t("schemaCache.kinds.columns"),
  marks: [
    viaClass("pg_catalog.pg_attribute a", "a", "a.attrelid WHERE a.attnum > 0"),
    viaClass("pg_catalog.pg_attrdef ad", "ad", "ad.adrelid"),
    // A type renamed in the schema renames the columns' types without touching pg_attribute.
    `SELECT t.typnamespace AS ns, pg_catalog.count(*) AS c, ${sum("t")} AS x FROM pg_catalog.pg_type t GROUP BY 1`,
  ],
  sql: (/** @type {string[]} */ schemas) =>
    "SELECT n.nspname, c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), " +
    "CASE WHEN a.attnotnull THEN 'n' ELSE '' END || CASE WHEN a.attnum = ANY (pk.indkey) THEN 'p' " +
    "ELSE '' END, pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), d.description FROM " +
    `pg_catalog.pg_attribute a ${ofRelations("a.attrelid")} LEFT JOIN pg_catalog.pg_attrdef ad ON ` +
    "ad.adrelid = a.attrelid AND ad.adnum = a.attnum LEFT JOIN pg_catalog.pg_index pk ON " +
    `pk.indrelid = c.oid AND pk.indisprimary ${comment("pg_class", "c.oid", "a.attnum")} WHERE ` +
    `${inSchemas(schemas)} AND ${COLUMN_OWNERS} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1, 2, a.attnum`,
};

/** Keys, checks, exclusions, foreign keys: table, contype, name, definition, columns, referenced. */
const constraints = {
  id: "constraints",
  label: t("schemaCache.kinds.keysAndForeignKeys"),
  marks: [
    `SELECT k.connamespace AS ns, pg_catalog.count(*) AS c, ${sum("k")} AS x FROM pg_catalog.pg_constraint k GROUP BY 1`,
  ],
  sql: (/** @type {string[]} */ schemas) =>
    "SELECT n.nspname, c.relname, k.contype::text, k.conname, pg_catalog.pg_get_constraintdef(k.oid, " +
    `true), ${names("k.conrelid", "k.conkey")}, rn.nspname, r.relname, CASE WHEN k.contype = 'f' THEN ` +
    `${names("k.confrelid", "k.confkey")} END FROM pg_catalog.pg_constraint k ${ofRelations("k.conrelid")} ` +
    "LEFT JOIN pg_catalog.pg_class r ON r.oid = k.confrelid LEFT JOIN pg_catalog.pg_namespace rn ON " +
    `rn.oid = r.relnamespace WHERE ${inSchemas(schemas)} AND NOT c.relispartition ORDER BY 1, 2, 4`,
};

/** Indexes: table, name, definition, "c" when a constraint owns it. */
const indexes = {
  id: "indexes",
  label: t("schemaCache.kinds.indexes"),
  marks: [viaClass("pg_catalog.pg_index i", "i", "i.indrelid")],
  sql: (/** @type {string[]} */ schemas) =>
    "SELECT n.nspname, c.relname, x.relname, pg_catalog.pg_get_indexdef(i.indexrelid), CASE WHEN " +
    "EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype " +
    "IN ('p', 'u', 'x')) THEN 'c' ELSE '' END FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class x ON " +
    `x.oid = i.indexrelid ${ofRelations("i.indrelid")} WHERE ${inSchemas(schemas)} AND NOT ` +
    "c.relispartition ORDER BY 1, 2, 3",
};

/** Triggers a person made: table, name, definition. */
const triggers = {
  id: "triggers",
  label: t("schemaCache.kinds.triggers"),
  marks: [viaClass("pg_catalog.pg_trigger t", "t", "t.tgrelid")],
  sql: (/** @type {string[]} */ schemas) =>
    "SELECT n.nspname, c.relname, t.tgname, pg_catalog.pg_get_triggerdef(t.oid, true) FROM " +
    `pg_catalog.pg_trigger t ${ofRelations("t.tgrelid")} WHERE ${inSchemas(schemas)} AND NOT ` +
    "t.tgisinternal AND NOT c.relispartition ORDER BY 1, 2, 3",
};

/**
 * Functions and procedures (not an extension's, nor made with a type, as a range's constructors):
 * name, arguments, prokind, result, oid, comment.
 */
const routines = {
  id: "routines",
  label: t("schemaCache.kinds.routines"),
  marks: [
    `SELECT p.pronamespace AS ns, pg_catalog.count(*) AS c, ${sum("p")} AS x FROM pg_catalog.pg_proc p GROUP BY 1`,
    "SELECT p.pronamespace AS ns, pg_catalog.count(*) AS c, pg_catalog.sum(d.xmin::text::bigint) AS x " +
      "FROM pg_catalog.pg_description d JOIN pg_catalog.pg_proc p ON p.oid = d.objoid AND " +
      "d.classoid = 'pg_catalog.pg_proc'::pg_catalog.regclass GROUP BY 1",
  ],
  sql: (/** @type {string[]} */ schemas) =>
    "SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), " +
    "p.prokind::text, coalesce(pg_catalog.pg_get_function_result(p.oid), ''), p.oid::text, " +
    "d.description FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
    `${comment("pg_proc", "p.oid")} WHERE ${inSchemas(schemas)} AND p.prokind IN ('f', 'p') AND NOT ` +
    "EXISTS (SELECT 1 FROM pg_catalog.pg_depend e WHERE e.objid = p.oid AND e.deptype IN ('e', 'i')) " +
    "ORDER BY 1, 2, 3",
};

/** @type {readonly Kind[]} */
export const POSTGRES_KINDS = Object.freeze([
  relations,
  columns,
  constraints,
  indexes,
  triggers,
  routines,
  ...READERS,
]);

/** What a cache was read with: a cache of other kinds is read again. */
export const signature = (/** @type {readonly Kind[]} */ kinds) =>
  kinds.map((kind) => kind.id).join(",");

/** System schemas: listed with the setting, never read unless chosen. */
export const isSystem = (/** @type {string} */ name) =>
  name.startsWith("pg_") || name === "information_schema";

/**
 * The fingerprint statement: every schema (not another session's temporary ones) with "s" for a
 * system one and its mark, the namespace's own xmin, then each kind's counts and sums; then the
 * database level's row (DATABASE) with its kinds' marks. Each row ends with server_version_num.
 * @param {readonly Kind[]} kinds
 */
export function marksSql(kinds) {
  const marks = kinds.filter((kind) => kind.level !== "database").flatMap((kind) => kind.marks);
  const level = kinds.filter((kind) => kind.level === "database").flatMap((kind) => kind.marks);
  const parts = marks.map((_, i) => `coalesce(m${i}.c::text || ':' || m${i}.x::text, '-')`);
  const joins = marks.map((sql, i) => `LEFT JOIN (${sql}) m${i} ON m${i}.ns = n.oid`).join(" ");
  const version = "pg_catalog.current_setting('server_version_num')";
  const database = level.length
    ? ` UNION ALL SELECT ${quoteText("postgresql", DATABASE)}, '', pg_catalog.concat_ws('.', ` +
      `${level.join(", ")}), ${version}`
    : "";
  return (
    "SELECT n.nspname, CASE WHEN n.nspname ~ '^pg_' OR n.nspname = 'information_schema' THEN 's' " +
    `ELSE '' END, pg_catalog.concat_ws('.', n.xmin::text, ${parts.join(", ")}), ${version} FROM ` +
    `pg_catalog.pg_namespace n ${joins} WHERE n.nspname !~ '^pg_(toast_)?temp_'${database} ORDER BY 1`
  );
}
