// The order completion offers its candidates in (ADR 0327): how the word typed matches (the whole
// name, its start, then inside it from three letters on), then scope (what the statement has in
// reach first: a join, a list or an expansion, the nearest level's columns, outer levels, FROM item
// names and CTEs, tables, schemas, functions and types, snippets, keywords), then the type a slot
// expects, then what the person picked before, then the name. Pure.

/**
 * @typedef {"column" | "alias" | "cte" | "table" | "view" | "schema" | "type" | "function" | "keyword"
 *   | "join" | "columns" | "expand" | "snippet" | "variable" | "parameter"} ItemKind
 * @typedef {{
 *   label: string, kind: ItemKind, detail: string, insert: string, info?: string, snippet?: boolean,
 *   range?: { from: number, to: number }, key: string, scope?: number, type?: string,
 * }} Item
 *   `insert` is a template with tab stops when `snippet`; `range` replaces that span of the
 *   statement instead of the word; `key` is what a pick is remembered by; `scope` and `type` rank it.
 * @typedef {Record<string, [number, number]>} Picks how often and when (ms) each key was picked
 */

export const LIMIT = 100;

/** The scope of each kind when its maker gives none. */
export const SCOPE = {
  join: 0,
  columns: 0,
  expand: 0,
  column: 1,
  variable: 2,
  parameter: 2,
  alias: 3,
  cte: 3,
  table: 4,
  view: 4,
  schema: 5,
  type: 6,
  function: 6,
  snippet: 7,
  keyword: 8,
};

const CATEGORIES = [
  [/^(smallint|integer|bigint|int\d?|smallserial|serial\d?|bigserial|oid)\b/u, "number"],
  [/^(numeric|decimal|real|double precision|float\d?|money)\b/u, "number"],
  [/^(text|character varying|varchar|character|char|bpchar|name|citext)\b/u, "text"],
  [/^(timestamp|date|time|interval)\b/u, "time"],
  [/^bool/u, "boolean"],
  [/^jsonb?\b/u, "json"],
];

/** A type without its modifiers, in lower case: `numeric(10,2)` → numeric. */
const baseOf = (/** @type {string} */ type) =>
  type
    .toLowerCase()
    .replace(/\(.*\)/u, "")
    .trim();

/** What kind of value a type holds, for the types an expected one takes. */
export function categoryOf(/** @type {string} */ type) {
  const base = baseOf(type);
  if (base.endsWith("[]")) return "array";
  for (const [re, name] of CATEGORIES) if (/** @type {RegExp} */ (re).test(base)) return name;
  return base;
}

/** 2 for the expected type itself, 1 for its kind, 0 otherwise. */
export function typeMatch(/** @type {string | undefined} */ type, /** @type {string} */ expected) {
  if (!type || !expected) return 0;
  if (baseOf(type) === baseOf(expected)) return 2;
  return categoryOf(type) === categoryOf(expected) ? 1 : 0;
}

/** What a pick of this kind and label is remembered by. */
export const keyOf = (/** @type {string} */ kind, /** @type {string} */ label) =>
  `${kind}:${label}`;

/**
 * @param {Item[]} items
 * @param {string} prefix the word typed
 * @param {{ picks?: Picks, expected?: string }} [options]
 * @returns {Item[]}
 */
export function rank(items, prefix, options = {}) {
  const p = prefix.toLowerCase();
  const picks = options.picks ?? {};
  const expected = options.expected ?? "";
  const seen = new Set();
  return items
    .map((item, at) => {
      const label = item.label.toLowerCase();
      const match =
        label === p ? 0 : label.startsWith(p) ? 1 : p.length > 2 && label.includes(p) ? 2 : 3;
      const pick = picks[item.key] ?? [0, 0];
      return { item, at, match, pick };
    })
    .filter(({ item, match }) => {
      const key = `${item.kind}\u0000${item.label}\u0000${item.detail}`;
      if (match === 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        a.match - b.match ||
        (a.item.scope ?? SCOPE[a.item.kind]) - (b.item.scope ?? SCOPE[b.item.kind]) ||
        typeMatch(b.item.type, expected) - typeMatch(a.item.type, expected) ||
        b.pick[0] - a.pick[0] ||
        b.pick[1] - a.pick[1] ||
        a.item.label.localeCompare(b.item.label) ||
        a.at - b.at,
    )
    .slice(0, LIMIT)
    .map(({ item }) => item);
}
