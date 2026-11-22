// A new table from a file (PG-60): each column's name made a plain SQL name (lower case, letters,
// digits and underscores, unique, never empty) and its PostgreSQL type the narrowest one every
// sampled value reads as (boolean, integer, bigint, numeric, date, timestamp, timestamptz, uuid,
// jsonb, else text; NULL and empty values say nothing), and the CREATE TABLE the import runs with
// the person's corrections. Dates read in the order the person chose (DateStyle). Pure.

import { quoteName } from "../sql/quote.js";

/**
 * @typedef {import("./csv.js").Row} Row
 * @typedef {"" | "DMY" | "MDY" | "YMD"} DateOrder
 * @typedef {{ name: string, type: string }} NewColumn A file column's place in the new table; an
 *   empty name leaves it out.
 */

/** The types the form offers, narrowest first; any other the person types is taken as written. */
export const TYPES = [
  "boolean",
  "integer",
  "bigint",
  "numeric",
  "date",
  "timestamp",
  "timestamptz",
  "uuid",
  "jsonb",
  "text",
];

const BOOL = /^(?:t|f|true|false|yes|no|y|n|on|off)$/iu;
const INT = /^[+-]?\d+$/u;
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const SLASH_DATE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/u;
const TIME = /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/u;
const ZONE = /(?:z|[+-]\d{2}(?::?\d{2})?)$/iu;
const INT4 = 2_147_483_647;

/** Whether `v` reads as a date in `order` (ISO always does). */
function isDate(/** @type {string} */ v, /** @type {DateOrder} */ order) {
  if (ISO_DATE.test(v)) return true;
  return order !== "" && SLASH_DATE.test(v);
}

/** Whether `v` reads as a timestamp: a date, a space or T, a time, maybe a zone. */
function stampOf(/** @type {string} */ v, /** @type {DateOrder} */ order) {
  const at = v.search(/[ T]/u);
  if (at < 0) return undefined;
  const date = v.slice(0, at);
  let time = v.slice(at + 1).trim();
  const zoned = ZONE.test(time);
  if (zoned) time = time.replace(ZONE, "").trim();
  if (!isDate(date, order) || !TIME.test(time)) return undefined;
  return zoned ? "timestamptz" : "timestamp";
}

/** The narrowest type one value reads as. */
function typeOfValue(/** @type {string} */ v, /** @type {DateOrder} */ order) {
  if (BOOL.test(v)) return "boolean";
  if (INT.test(v)) return Math.abs(Number(v)) <= INT4 ? "integer" : "bigint";
  if (NUMERIC.test(v)) return "numeric";
  if (UUID.test(v)) return "uuid";
  if (isDate(v, order)) return "date";
  const stamp = stampOf(v, order);
  if (stamp) return stamp;
  if (/^[[{]/u.test(v)) {
    try {
      JSON.parse(v);
      return "jsonb";
    } catch {
      return "text";
    }
  }
  return "text";
}

/** The type two columns' values both read as. */
function widen(/** @type {string} */ a, /** @type {string} */ b) {
  if (a === b) return a;
  const numbers = ["integer", "bigint", "numeric"];
  if (numbers.includes(a) && numbers.includes(b))
    return numbers[Math.max(numbers.indexOf(a), numbers.indexOf(b))] ?? "numeric";
  const times = ["date", "timestamp", "timestamptz"];
  if (times.includes(a) && times.includes(b))
    return times[Math.max(times.indexOf(a), times.indexOf(b))] ?? "timestamptz";
  return "text";
}

/** The type a column's sampled values all read as; text when none says. */
export function inferType(/** @type {(string | null)[]} */ values, /** @type {DateOrder} */ order) {
  let type = "";
  for (const v of values) {
    if (v === null || v.trim() === "") continue;
    const next = typeOfValue(v.trim(), order);
    type = type === "" ? next : widen(type, next);
    if (type === "text") return type;
  }
  return type || "text";
}

/** A file column's name as a plain SQL name. */
export function plainName(/** @type {string} */ name) {
  const plain = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return /^\p{N}/u.test(plain) ? `c_${plain}` : plain || "column";
}

/**
 * Each file column's place in a new table, from the sample.
 * @param {string[]} columns
 * @param {Row[]} rows
 * @param {DateOrder} order
 * @returns {NewColumn[]}
 */
export function inferColumns(columns, rows, order) {
  const used = new Set();
  return columns.map((column, i) => {
    const base = plainName(column);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    return {
      name,
      type: inferType(
        rows.map((r) => r[i] ?? null),
        order,
      ),
    };
  });
}

/** The table a file's name suggests. */
export const tableFromFile = (/** @type {string} */ file) =>
  plainName(file.replace(/\.[^.]*$/u, "")) || "imported";

/**
 * The CREATE TABLE of a new table, or the sentence why it cannot be made.
 * @param {string} table The table's qualified name, as SQL.
 * @param {NewColumn[]} columns
 * @returns {{ sql: string } | { problem: string }}
 */
export function createTable(table, columns) {
  const kept = columns.filter((c) => c.name.trim() !== "");
  if (kept.length === 0) return { problem: "Give at least one column a name." };
  const names = kept.map((c) => c.name.trim());
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) return { problem: `Two columns are named ${twice}.` };
  const bad = kept.find((c) => !/^[\p{L}\p{N} _[\](),]+$/u.test(c.type.trim()));
  if (bad) return { problem: `${bad.name}: name a type, as ${TYPES.slice(0, 3).join(", ")}.` };
  const body = kept.map((c) => `  ${quoteName("postgresql", c.name.trim())} ${c.type.trim()}`);
  return { sql: `CREATE TABLE ${table} (\n${body.join(",\n")}\n)` };
}
