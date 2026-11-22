// What the server is asked for an object's usages (PG-32), two read-only statements run as one
// catalog read: what pg_depend records depends on it (views and rules through their rewrite rules,
// routines with SQL-standard bodies, triggers, constraints, policies, column defaults), and the
// routines whose body text names it, which the catalog does not record (PL/pgSQL, quoted SQL
// bodies), for the page to scan (mentions.js). Each read is capped one row past its limit, so the
// panel can say it was cut. Pure.

import { quoteText } from "../sql/quote.js";

/** @typedef {import("./target.js").Aim} Aim */

/** Rows read of each kind at most; one more says the list was cut. */
export const CATALOG_MAX = 500;
export const BODIES_MAX = 200;

const lit = (/** @type {string} */ value) => quoteText("postgresql", value);

/** The objects the usages are of, as (class, oid, column number) rows; null for no server object. */
function targetOf(/** @type {Aim} */ aim) {
  const ns = (/** @type {string} */ column, /** @type {string} */ schema) =>
    `${column} = (SELECT oid FROM pg_namespace WHERE nspname = ${lit(schema)})`;
  if (aim.kind === "relation")
    return `SELECT 'pg_class'::regclass AS cls, c.oid, 0 AS sub FROM pg_class c WHERE ${ns("c.relnamespace", aim.schema)} AND c.relname = ${lit(aim.name)}`;
  if (aim.kind === "column")
    return `SELECT 'pg_class'::regclass AS cls, a.attrelid AS oid, a.attnum::int AS sub FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE ${ns("c.relnamespace", aim.schema)} AND c.relname = ${lit(aim.table)} AND a.attname = ${lit(aim.name)} AND NOT a.attisdropped`;
  if (aim.kind === "function")
    return `SELECT 'pg_proc'::regclass AS cls, p.oid, 0 AS sub FROM pg_proc p WHERE ${ns("p.pronamespace", aim.schema)} AND p.proname = ${lit(aim.name)}`;
  if (aim.kind === "type")
    return `SELECT 'pg_type'::regclass AS cls, t.oid, 0 AS sub FROM pg_type t WHERE ${ns("t.typnamespace", aim.schema)} AND t.typname = ${lit(aim.name)}`;
  return null;
}

/** The name the bodies are searched for: a column's, a relation's, a routine's, a type's. */
export const searchedName = (/** @type {Aim} */ aim) => aim.name;

/**
 * The statements that read the usages of an object, or null for a name the statement defines.
 * Columns of the first: kind, schema, name, table (what it is on), detail. Of the second: schema,
 * name, identity arguments, kind, language, source.
 * @param {Aim} aim
 * @returns {string | null}
 */
export function usagesSql(aim) {
  const target = targetOf(aim);
  if (!target) return null;
  const on = (/** @type {string} */ c) => `JOIN pg_class ${c} ON ${c}.oid = `;
  const catalog = `WITH target AS (${target}),
dep AS (
  SELECT DISTINCT d.classid, d.objid, d.deptype FROM pg_depend d JOIN target t
    ON d.refclassid = t.cls AND d.refobjid = t.oid AND (t.sub = 0 OR d.refobjsubid = t.sub)
  WHERE d.deptype IN ('n', 'a')
)
SELECT DISTINCT u.kind, u.schema, u.name, u.on_table, u.detail FROM (
  SELECT CASE WHEN r.rulename <> '_RETURN' THEN 'rule' WHEN c.relkind = 'm' THEN 'materialized view' ELSE 'view' END AS kind,
    n.nspname AS schema, CASE WHEN r.rulename = '_RETURN' THEN c.relname ELSE r.rulename END AS name,
    CASE WHEN r.rulename = '_RETURN' THEN '' ELSE c.relname END AS on_table, '' AS detail
  FROM dep d JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND r.oid = d.objid
  ${on("c")}r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE d.deptype = 'n' AND r.ev_class NOT IN (SELECT oid FROM target WHERE cls = 'pg_class'::regclass)
  UNION ALL
  SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, n.nspname, p.proname, '',
    pg_get_function_identity_arguments(p.oid)
  FROM dep d JOIN pg_proc p ON d.classid = 'pg_proc'::regclass AND p.oid = d.objid
  JOIN pg_namespace n ON n.oid = p.pronamespace WHERE d.deptype = 'n'
  UNION ALL
  SELECT 'trigger', n.nspname, g.tgname, c.relname, ''
  FROM dep d JOIN pg_trigger g ON d.classid = 'pg_trigger'::regclass AND g.oid = d.objid
  ${on("c")}g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT g.tgisinternal
  UNION ALL
  SELECT CASE k.contype WHEN 'f' THEN 'foreign key' WHEN 'c' THEN 'check' ELSE 'constraint' END,
    n.nspname, k.conname, coalesce(c.relname, ''), pg_get_constraintdef(k.oid)
  FROM dep d JOIN pg_constraint k ON d.classid = 'pg_constraint'::regclass AND k.oid = d.objid
  LEFT JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = k.connamespace
  WHERE d.deptype = 'n'
  UNION ALL
  SELECT 'policy', n.nspname, o.polname, c.relname, ''
  FROM dep d JOIN pg_policy o ON d.classid = 'pg_policy'::regclass AND o.oid = d.objid
  ${on("c")}o.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'default', n.nspname, a.attname, c.relname, pg_get_expr(f.adbin, f.adrelid)
  FROM dep d JOIN pg_attrdef f ON d.classid = 'pg_attrdef'::regclass AND f.oid = d.objid
  JOIN pg_attribute a ON a.attrelid = f.adrelid AND a.attnum = f.adnum
  ${on("c")}f.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE d.deptype = 'n'
) u ORDER BY 1, 2, 4, 3 LIMIT ${CATALOG_MAX + 1}`;
  const bodies = `SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
  CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, l.lanname, p.prosrc
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
WHERE l.lanname NOT IN ('c', 'internal') AND n.nspname <> 'information_schema'
  AND left(n.nspname, 3) <> 'pg_' AND strpos(lower(p.prosrc), lower(${lit(searchedName(aim))})) > 0
ORDER BY 1, 2, 3 LIMIT ${BODIES_MAX + 1}`;
  return `${catalog};\n${bodies}`;
}
