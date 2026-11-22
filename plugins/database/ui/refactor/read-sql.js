// What an object's rename asks the server (PG-33), as one read-only catalog read: the facts the
// script needs (a relation's kind, a routine's overloads, a type's kind, whether another schema
// holds the same name, the other relations with a column of the same name), every function and
// procedure whose body text names it with what rewriting it takes (pg_get_functiondef, parameter
// names, the tables whose triggers run it), and then navigation's usages read (navigate/
// usages-sql.js), whose dependency catalog rows are what follows the rename by itself. Pure.

import { usagesSql } from "../navigate/usages-sql.js";
import { quoteText } from "../sql/quote.js";

/**
 * @typedef {import("../navigate/target.js").Aim} Aim
 */

/** Bodies read at most; one more says the list was cut. */
export const BODIES_MAX = 200;

const lit = (/** @type {string} */ v) => quoteText("postgresql", v);
const ns = (/** @type {string} */ column, /** @type {string} */ schema) =>
  `${column} = (SELECT oid FROM pg_namespace WHERE nspname = ${lit(schema)})`;
/** A namespace that is the server's own. */
const SYSTEM = (/** @type {string} */ n) =>
  `(left(${n}.nspname, 3) = 'pg_' OR ${n}.nspname = 'information_schema')`;

/** Relations other than `not` with a column of this name, comma separated. */
const holders = (/** @type {string} */ column, /** @type {string} */ not) =>
  `(SELECT coalesce(string_agg(DISTINCT hc.relname, ','), '') FROM pg_attribute ha
    JOIN pg_class hc ON hc.oid = ha.attrelid JOIN pg_namespace hn ON hn.oid = hc.relnamespace
    WHERE ha.attname = ${lit(column)} AND ha.attnum > 0 AND NOT ha.attisdropped
      AND hc.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT ${SYSTEM("hn")} AND hc.oid <> ${not})`;

/**
 * The facts statement: one row of (detail, elsewhere, holders, overloads as JSON).
 * @param {Aim} aim
 */
export function factsSql(aim) {
  if (aim.kind === "relation" || aim.kind === "column") {
    const table = aim.kind === "column" ? aim.table : aim.name;
    const found =
      aim.kind === "column"
        ? `AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = ${lit(aim.name)} AND NOT a.attisdropped)`
        : "";
    return `SELECT c.relkind::text,
  (SELECT count(*) FROM pg_class o JOIN pg_namespace n ON n.oid = o.relnamespace
    WHERE o.relname = c.relname AND o.oid <> c.oid AND NOT ${SYSTEM("n")})::int,
  ${holders(aim.name, "c.oid")}, '[]'
FROM pg_class c WHERE ${ns("c.relnamespace", aim.schema)} AND c.relname = ${lit(table)} ${found}`;
  }
  if (aim.kind === "function")
    return `SELECT 'f', (SELECT count(*) FROM pg_proc o JOIN pg_namespace n ON n.oid = o.pronamespace
    WHERE o.proname = ${lit(aim.name)} AND NOT ${ns("o.pronamespace", aim.schema)} AND NOT ${SYSTEM("n")})::int, '',
  coalesce((SELECT json_agg(json_build_array(pg_get_function_identity_arguments(p.oid), p.prokind::text) ORDER BY p.oid)
    FROM pg_proc p WHERE ${ns("p.pronamespace", aim.schema)} AND p.proname = ${lit(aim.name)} AND p.prokind IN ('f', 'p'))::text, '[]')`;
  if (aim.kind === "type")
    return `SELECT t.typtype::text, (SELECT count(*) FROM pg_type o JOIN pg_namespace n ON n.oid = o.typnamespace
    WHERE o.typname = t.typname AND o.oid <> t.oid AND NOT ${SYSTEM("n")})::int,
  ${holders(aim.name, "0")}, '[]'
FROM pg_type t WHERE ${ns("t.typnamespace", aim.schema)} AND t.typname = ${lit(aim.name)}`;
  return `SELECT 'n', 0, '', '[]' FROM pg_namespace WHERE nspname = ${lit(aim.name)}`;
}

/**
 * The bodies statement: schema, name, identity arguments, kind, language, source, definition,
 * parameter names (JSON), the tables whose triggers run it (JSON), its settings.
 * @param {string} searched the name the bodies are searched for
 */
export function bodiesSql(searched) {
  return `SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid),
  CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, l.lanname, p.prosrc,
  pg_get_functiondef(p.oid), coalesce(array_to_json(p.proargnames)::text, '[]'),
  coalesce((SELECT json_agg(DISTINCT tn.nspname || '.' || tc.relname) FROM pg_trigger g
    JOIN pg_class tc ON tc.oid = g.tgrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    WHERE g.tgfoid = p.oid AND NOT g.tgisinternal)::text, '[]'),
  coalesce(array_to_string(p.proconfig, ', '), '')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
WHERE p.prokind IN ('f', 'p') AND l.lanname NOT IN ('c', 'internal') AND NOT ${SYSTEM("n")}
  AND (strpos(lower(p.prosrc), lower(${lit(searched)})) > 0
    OR strpos(lower(coalesce(array_to_string(p.proconfig, ','), '')), lower(${lit(searched)})) > 0)
ORDER BY 1, 2, 3 LIMIT ${BODIES_MAX + 1}`;
}

/**
 * The whole read: facts, bodies, then the dependency catalog's usages (none for a schema).
 * @param {Aim} aim
 */
export function renameReadSql(aim) {
  const usages = usagesSql(aim);
  return [factsSql(aim), bodiesSql(aim.name), ...(usages ? [usages] : [])].join(";\n");
}
