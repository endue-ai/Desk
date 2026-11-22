// Following foreign keys (PG-41, ADR 0322), without the DOM or a server: the keys of a table both
// ways as the schema cache holds them (or as pg_constraint's rows give them), which result columns
// link and where to, the quick filters a row's key values make (ADR 0288's filters: names quoted,
// values literals), the search of a referenced table a page at a time, its readable column, and the
// trail back. Nothing is guessed from names: a link is a declared constraint.

import { filterSql } from "../grid/filters.js";
import { qualified, quoteName, quoteText } from "../sql/quote.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../grid/filters.js").Filter} Filter
 * @typedef {import("../grid/filters.js").SortKey} SortKey
 * @typedef {{ schema: string, table: string, columns: string[] }} End
 * @typedef {{ name: string, from: End, to: End }} Key
 *   A foreign key: `from` the referencing table and its columns, `to` the referenced ones, in order.
 * @typedef {{ outgoing: Key[], incoming: Key[] }} Keys
 *   `outgoing`: the table's own keys; `incoming`: the keys that point at it (its own self-reference too).
 * @typedef {{ where: string, order: string, sort: SortKey[], filters: Filter[], offset: number }} PageState
 * @typedef {{ id: string, table: PageState | null }} Place A buffer followed from, and its table view's state.
 */

/** Rows of a referenced table a search page shows. */
export const PAGE = 50;
/** Steps the trail back keeps. */
export const TRAIL_MAX = 50;

const nameOf = (/** @type {End} */ end) => `${end.schema}.${end.table}`;
/** Keys by the referencing table's schema, then its name, then the key's. */
const byPlace = (/** @type {Key} */ a, /** @type {Key} */ b) =>
  a.from.schema.localeCompare(b.from.schema) ||
  a.from.table.localeCompare(b.from.table) ||
  a.name.localeCompare(b.name);

/**
 * A table's keys as the schema cache holds them: undefined when it does not hold the table (its
 * schema is not read, or it was made since), so the caller reads pg_constraint instead. The keys
 * pointing at it are those of every schema the cache holds.
 * @param {import("../schema-cache/view.js").CacheView | undefined} view
 * @param {string} schema
 * @param {string} table
 * @returns {Keys | undefined}
 */
export function keysOfCache(view, schema, table) {
  const own = view?.held(schema) ? view.foreignKeys(schema, table) : undefined;
  if (!view || !own) return undefined;
  /** @type {(from: string, on: string, k: import("../schema-cache/model.js").ForeignKey) => Key} */
  const keyOf = (from, on, k) => ({
    name: k.name,
    from: { schema: from, table: on, columns: k.columns },
    to: { schema: k.schema, table: k.table, columns: k.refColumns },
  });
  /** @type {Key[]} */
  const incoming = [];
  for (const s of view.schemas())
    for (const object of view.objects(s) ?? [])
      for (const k of view.foreignKeys(s, object.name) ?? [])
        if (k.schema === schema && k.table === table) incoming.push(keyOf(s, object.name, k));
  return { outgoing: own.map((k) => keyOf(schema, table, k)), incoming: incoming.sort(byPlace) };
}

const COLUMNS = (/** @type {string} */ rel, /** @type {string} */ keys) =>
  "(SELECT pg_catalog.json_agg(a.attname ORDER BY u.o) FROM pg_catalog.unnest(" +
  `k.${keys}) WITH ORDINALITY u(n, o) JOIN pg_catalog.pg_attribute a ON a.attrelid = k.${rel} AND ` +
  "a.attnum = u.n)::text";

/** The keys of a table both ways, read from pg_constraint (a partition's copies left out). */
export function keysSql(/** @type {string} */ schema, /** @type {string} */ table) {
  const s = quoteText("postgresql", schema);
  const t = quoteText("postgresql", table);
  return (
    `SELECT k.conname, cn.nspname, c.relname, ${COLUMNS("conrelid", "conkey")}, rn.nspname, r.relname, ` +
    `${COLUMNS("confrelid", "confkey")} FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON ` +
    "c.oid = k.conrelid JOIN pg_catalog.pg_namespace cn ON cn.oid = c.relnamespace JOIN " +
    "pg_catalog.pg_class r ON r.oid = k.confrelid JOIN pg_catalog.pg_namespace rn ON rn.oid = " +
    `r.relnamespace WHERE k.contype = 'f' AND k.conparentid = 0 AND ((cn.nspname = ${s} AND ` +
    `c.relname = ${t}) OR (rn.nspname = ${s} AND r.relname = ${t})) ORDER BY 2, 3, 1`
  );
}

/** keysSql's rows as a table's keys. @returns {Keys} */
export function keysOfRows(
  /** @type {(string | null)[][]} */ rows,
  /** @type {string} */ schema,
  /** @type {string} */ table,
) {
  const list = (/** @type {string | null | undefined} */ json) => {
    try {
      const parsed = JSON.parse(json ?? "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  /** @type {Keys} */
  const keys = { outgoing: [], incoming: [] };
  for (const [name, fs, ft, fc, ts, tt, tc] of rows) {
    const key = {
      name: name ?? "",
      from: { schema: fs ?? "", table: ft ?? "", columns: list(fc) },
      to: { schema: ts ?? "", table: tt ?? "", columns: list(tc) },
    };
    if (key.from.schema === schema && key.from.table === table) keys.outgoing.push(key);
    if (key.to.schema === schema && key.to.table === table) keys.incoming.push(key);
  }
  keys.incoming.sort(byPlace);
  return keys;
}

/**
 * The result columns that link: each column of a key whose columns the result all holds, with the
 * keys it is in.
 * @param {Key[]} keys The table's own keys.
 * @param {string[]} columns The result's column names.
 */
export function linkColumns(keys, columns) {
  /** @type {Map<number, Key[]>} */
  const links = new Map();
  for (const key of keys) {
    const at = key.from.columns.map((name) => columns.indexOf(name));
    if (at.some((c) => c < 0)) continue;
    for (const c of at) links.set(c, [...(links.get(c) ?? []), key]);
  }
  return links;
}

/** What a link cell's title says: where it points, and how to go there. */
export function linkTitle(/** @type {Key[]} */ keys) {
  const where = keys.map((k) => `${nameOf(k.to)} (${k.to.columns.join(", ")})`).join(" and ");
  return `Points at ${where}: g or Mod+click opens ${keys.length > 1 ? "one" : "that row"}`;
}

/**
 * The quick filters that keep the rows a key's values name: `from` columns read in the row, each an
 * `=` filter on its `onto` column; or why there is none (a NULL, a column the result lacks).
 * @param {{ from: string[], onto: string[], columns: string[], row: (string | null)[], numeric: boolean[] }} at
 * @returns {{ filters: Filter[] } | { error: string }}
 */
export function keyFilters({ from, onto, columns, row, numeric }) {
  /** @type {Filter[]} */
  const filters = [];
  for (const [i, name] of from.entries()) {
    const c = columns.indexOf(name);
    if (c < 0) return { error: `${name} is not in this result: add it to follow the key.` };
    const value = row[c] ?? null;
    if (value === null) return { error: `${name} is NULL: the key points at no row.` };
    const target = onto[i] ?? name;
    filters.push({ key: target, name: target, op: "eq", value, numeric: numeric[c] ?? false });
  }
  return { filters };
}

/**
 * One page of a referenced table's rows for the search: its key and readable column, rows holding
 * `text` in either (ILIKE, its wildcards literal), by the key; one row more says another page follows.
 * @param {Dialect} dialect
 * @param {{ schema: string, table: string, key: string[], readable: string, text: string, offset: number }} search
 */
export function searchSql(dialect, { schema, table, key, readable, text, offset }) {
  const names = readable ? [...key, readable] : key;
  const where = text
    ? ` WHERE ${names
        .map((name) =>
          filterSql(dialect, { key: name, name, op: "contains", value: text, numeric: false }),
        )
        .join(" OR ")}`
    : "";
  const list = (/** @type {string[]} */ cols) => cols.map((n) => quoteName(dialect, n)).join(", ");
  return (
    `SELECT ${list(names)} FROM ${qualified(dialect, schema, table)}${where} ORDER BY ${list(key)} ` +
    `LIMIT ${PAGE + 1} OFFSET ${offset}`
  );
}

const TEXT = /^(?:text|citext|name|character varying|varchar|character|char|bpchar)\b/iu;

/** A referenced table's readable column: its first text column outside the key, or "". */
export function readableColumn(
  /** @type {{ name: string, type: string }[]} */ columns,
  /** @type {string[]} */ key,
) {
  return columns.find((c) => !key.includes(c.name) && TEXT.test(c.type))?.name ?? "";
}

/** Where keys were followed from, the newest last, at most `max`. */
export function createTrail(max = TRAIL_MAX) {
  /** @type {Place[]} */
  const places = [];
  return {
    push(/** @type {Place} */ place) {
      places.push(place);
      if (places.length > max) places.shift();
    },
    pop: () => places.pop(),
    size: () => places.length,
  };
}
