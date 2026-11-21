// SQL pieces the PostgreSQL kinds of PG-50 share: the schemas a reader names, a comment's join, an
// extension's members left out, a fingerprint's count and sum, options without their secrets, and
// a JSON column read back. Every name in a statement is a quoted literal (quote.js). Pure.

import { quoteText } from "../../sql/quote.js";

/** `n.nspname IN (...)`, every name a literal. */
export const inSchemas = (/** @type {string[]} */ schemas) =>
  `n.nspname IN (${schemas.map((s) => quoteText("postgresql", s)).join(", ")})`;

/** A catalog's regclass literal. */
export const cls = (/** @type {string} */ catalog) =>
  `'pg_catalog.${catalog}'::pg_catalog.regclass`;

/** The comment of an object of a catalog, as `d.description`. */
export const described = (
  /** @type {string} */ catalog,
  /** @type {string} */ oid,
  alias = "d",
  table = "pg_description",
) =>
  `LEFT JOIN pg_catalog.${table} ${alias} ON ${alias}.objoid = ${oid} AND ${alias}.classoid = ${cls(catalog)}` +
  (table === "pg_description" ? ` AND ${alias}.objsubid = 0` : "");

/**
 * Neither a member of an extension (listed with the extension) nor made with another object (a
 * range's constructors and casts, an array type, a table's row type).
 */
export const notMember = (/** @type {string} */ catalog, /** @type {string} */ oid) =>
  `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend x WHERE x.classid = ${cls(catalog)} AND ` +
  `x.objid = ${oid} AND x.deptype IN ('e', 'i'))`;

/** `sum(alias.xmin)` as a bigint. */
export const xsum = (/** @type {string} */ alias) => `pg_catalog.sum(${alias}.xmin::text::bigint)`;

/** A per-schema mark: namespace, count and summed xmin of a catalog's rows. */
export const markOf = (
  /** @type {string} */ from,
  /** @type {string} */ ns,
  /** @type {string} */ alias,
) => `SELECT ${ns} AS ns, pg_catalog.count(*) AS c, ${xsum(alias)} AS x FROM ${from} GROUP BY 1`;

/** A database-level mark: one text of the count and summed xmin of a catalog's rows. */
export const countOf = (/** @type {string} */ from, /** @type {string} */ alias) =>
  `(SELECT pg_catalog.count(*)::text || ':' || coalesce(${xsum(alias)}, 0)::text FROM ${from})`;

/** A database-level mark for rows whose xmin cannot be read: an md5 of the readable columns. */
export const digestOf = (/** @type {string} */ from, /** @type {string} */ row) =>
  `(SELECT pg_catalog.md5(coalesce(pg_catalog.string_agg(${row}, ',' ORDER BY ${row}), '')) FROM ${from})`;

/** Options (`name=value`) without those whose name may hold a secret. */
export const safeOptions = (/** @type {string} */ column) =>
  `pg_catalog.to_json(ARRAY(SELECT o FROM pg_catalog.unnest(${column}) o WHERE ` +
  `pg_catalog.split_part(o, '=', 1) !~* '(pass|secret|token|key)'))`;

/** How many options were left out as secret. */
export const hiddenOptions = (/** @type {string} */ column) =>
  `(SELECT pg_catalog.count(*) FROM pg_catalog.unnest(${column}) o WHERE ` +
  `pg_catalog.split_part(o, '=', 1) ~* '(pass|secret|token|key)')`;

/** A JSON column as read back (an object or array), or {} when it is not JSON. */
export function json(/** @type {string | null | undefined} */ text) {
  try {
    const value = JSON.parse(text ?? "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
