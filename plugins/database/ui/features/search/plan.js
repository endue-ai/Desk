// Which tables a search reads, from the catalog's public functions (the schema cache for
// PostgreSQL, ADR 0285): the chosen schemas' tables, partitioned tables and materialized views
// (views and foreign tables keep their rows elsewhere), narrowed by the person's names, and the
// estimate shown before it starts: how many tables and about how many rows, which are past the size
// limit and left out unless asked. A table's own columns are read when its turn comes. No DOM.

import { formatCount } from "../../format.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./model.js").Options} Options
 * @typedef {{ schema: string, name: string, kind: string, rows: number | null, partitioned: boolean }} Candidate
 * @typedef {{
 *   search: Candidate[], over: Candidate[], rows: number, unknown: number,
 * }} Estimate
 *   `search` the tables it reads, `over` those past the size limit it leaves out; `rows` the
 *   estimated rows of `search`, `unknown` how many of them have no estimate.
 * @typedef {{ objects(conn: Connection, schema: string, quiet?: boolean): Promise<import("../../schema/common.js").SchemaObject[]> }} Objects
 */

/** The kinds of object a search reads. */
export const SEARCHED_KINDS = new Set(["table", "materialized view"]);

/** A name pattern (`*` any run of characters) as a test, case-insensitively. */
function pattern(/** @type {string} */ text) {
  const escaped = text.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "iu");
}

/**
 * The test of the person's table names: `orders`, `sales.orders`, `audit_*`; "" keeps every one.
 * @param {string} text
 */
export function tableTest(text) {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return () => true;
  const tests = parts.map((p) => {
    const dot = p.indexOf(".");
    return dot > 0
      ? { schema: pattern(p.slice(0, dot)), name: pattern(p.slice(dot + 1)) }
      : { schema: null, name: pattern(p) };
  });
  return (/** @type {string} */ schema, /** @type {string} */ name) =>
    tests.some((t) => (t.schema === null || t.schema.test(schema)) && t.name.test(name));
}

/**
 * The tables of the chosen schemas a search may read, in schema then name order.
 * @param {Objects} catalog
 * @param {Connection} conn
 * @param {Options} options
 * @param {boolean} [quiet] never ask for a password (an agent is reading)
 * @returns {Promise<Candidate[]>}
 */
export async function candidatesOf(catalog, conn, options, quiet = false) {
  const keep = tableTest(options.tables);
  /** @type {Candidate[]} */
  const out = [];
  for (const schema of options.schemas) {
    const objects = await catalog.objects(conn, schema, quiet);
    for (const o of objects)
      if (SEARCHED_KINDS.has(o.kind) && keep(schema, o.name))
        out.push({
          schema,
          name: o.name,
          kind: o.kind,
          rows: o.rows,
          partitioned: o.detail === "partitioned",
        });
  }
  return out.sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));
}

/** @returns {Estimate} */
export function estimateOf(/** @type {Candidate[]} */ candidates, /** @type {Options} */ options) {
  const past = (/** @type {Candidate} */ c) =>
    !options.big && c.rows !== null && c.rows > options.sizeLimit;
  const search = candidates.filter((c) => !past(c));
  return {
    search,
    over: candidates.filter(past),
    rows: search.reduce((n, c) => n + (c.rows ?? 0), 0),
    unknown: search.filter((c) => c.rows === null).length,
  };
}

/** About how many rows, in words: 950, 12 thousand, 1.2 million. */
export function aboutRows(/** @type {number} */ n) {
  if (n < 10_000) return formatCount(n);
  if (n < 1_000_000) return `${formatCount(Math.round(n / 1000))} thousand`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/u, "")} million`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/u, "")} billion`;
}

/** The sentence said before a search starts: what it reads and what it leaves out. */
export function estimateText(/** @type {Estimate} */ e, /** @type {Options} */ options) {
  const n = e.search.length;
  if (n === 0 && e.over.length === 0) return "No table to search in the chosen schemas.";
  const unknown = e.unknown
    ? `${e.unknown === n ? "" : " and "}${formatCount(e.unknown)} of unknown size`
    : "";
  const rows = e.unknown === n ? "" : `about ${aboutRows(e.rows)} rows`;
  const reads = `Reads ${formatCount(n)} ${n === 1 ? "table" : "tables"}${n ? `, ${rows}${unknown}` : ""}`;
  const each = `one at a time, read-only, at most ${options.timeoutSeconds} s each`;
  const left = e.over.length
    ? ` Left out, over ${formatCount(options.sizeLimit)} rows: ${e.over
        .slice(0, 3)
        .map((c) => `${c.schema}.${c.name} (about ${aboutRows(c.rows ?? 0)})`)
        .join(", ")}${e.over.length > 3 ? ` and ${formatCount(e.over.length - 3)} more` : ""}.`
    : "";
  return `${reads}, ${each}.${left}`;
}
