// Which columns a value is looked for in: a column's type read as a family (text-like, numbers,
// uuid, JSON, dates and times as text) on each engine, and whether a column of that family can hold
// the value at all for the way it is matched: a number is never looked for in a uuid column, an
// integer column takes only a whole number to equal, a date's text has digits and date marks only. Booleans, bytes,
// arrays, enums and every other type are not searched. Pure.

/**
 * @typedef {import("../../engines/common.js").EngineId} EngineId
 * @typedef {"text" | "number" | "uuid" | "json" | "date"} Family
 * @typedef {"equals" | "contains" | "starts" | "regex"} Match
 * @typedef {{ name: string, type: string, family: Family, whole: boolean }} Searched
 *   `whole`: an integer column, which equals only a whole number.
 */

/** The families in the form's order, with the words it shows. */
export const FAMILIES = /** @type {const} */ ([
  ["text", "Text"],
  ["number", "Numbers"],
  ["uuid", "UUID"],
  ["json", "JSON"],
  ["date", "Dates as text"],
]);
export const FAMILY_IDS = /** @type {Family[]} */ (FAMILIES.map(([id]) => id));

/** The ways to match, with the words the form shows. */
export const MATCHES = /** @type {const} */ ([
  ["equals", "Equals"],
  ["contains", "Contains"],
  ["starts", "Starts with"],
  ["regex", "Regular expression"],
]);
export const MATCH_IDS = /** @type {Match[]} */ (MATCHES.map(([id]) => id));

/** A number as SQL and jsonpath write it: digits, a point, an exponent, one sign. */
export const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu;
const WHOLE = /^[-+]?\d+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** A piece of a number's text: digits and points, a sign first. */
const NUMBER_PART = /^[-+]?[\d.]*\d[\d.]*$/u;
/** A piece of a uuid's text that is not a plain number. */
const UUID_PART = /^[0-9a-f-]+$/iu;

/**
 * A column's type as a family, or undefined when it is not searched.
 * @param {EngineId} engine
 * @param {string} type as the catalog gives it (format_type, COLUMN_TYPE, a declared type)
 * @returns {{ family: Family, whole: boolean } | undefined}
 */
export function familyOf(engine, type) {
  const t = type.trim().toLowerCase();
  if (engine === "postgresql") return postgresFamily(t);
  if (engine === "mysql") return mysqlFamily(t);
  return sqliteFamily(t);
}

/** PostgreSQL's format_type, a type of another schema read by its own name. */
function postgresFamily(/** @type {string} */ type) {
  if (type.endsWith("]")) return undefined;
  const t = type.replace(/^(?:"[^"]+"|[a-z_][a-z0-9_]*)\./u, "");
  if (/^(?:text|character varying|varchar|character|char|bpchar|name|citext)\b/u.test(t))
    return { family: "text", whole: false };
  if (/^(?:smallint|integer|bigint|int2|int4|int8)$/u.test(t))
    return { family: "number", whole: true };
  if (/^(?:numeric|decimal|real|double precision|float4|float8)\b/u.test(t))
    return { family: "number", whole: false };
  if (t === "uuid") return { family: "uuid", whole: false };
  if (t === "json" || t === "jsonb") return { family: "json", whole: false };
  if (/^(?:date|time|timestamp|interval)\b/u.test(t)) return { family: "date", whole: false };
  return undefined;
}

/** MySQL's and MariaDB's COLUMN_TYPE. */
function mysqlFamily(/** @type {string} */ type) {
  if (/^(?:char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/u.test(type))
    return { family: "text", whole: false };
  if (/^(?:tinyint|smallint|mediumint|int|integer|bigint)\b/u.test(type))
    return { family: "number", whole: true };
  if (/^(?:decimal|numeric|float|double|real)\b/u.test(type))
    return { family: "number", whole: false };
  if (/^json\b/u.test(type)) return { family: "json", whole: false };
  if (/^(?:date|datetime|timestamp|time|year)\b/u.test(type))
    return { family: "date", whole: false };
  return undefined;
}

/** SQLite's declared type, by its affinity rules; JSON, UUID and dates by their names. */
function sqliteFamily(/** @type {string} */ type) {
  if (type.includes("json")) return { family: "json", whole: false };
  if (type.includes("uuid")) return { family: "uuid", whole: false };
  if (type.includes("date") || type.includes("time")) return { family: "date", whole: false };
  if (type.includes("int")) return { family: "number", whole: true };
  if (type === "" || /char|clob|text/u.test(type)) return { family: "text", whole: false };
  if (/real|floa|doub|numeric|decimal/u.test(type)) return { family: "number", whole: false };
  return undefined;
}

/** A date's or a time's text: digits and the marks between them. */
const DATE_PART = /^[\d\s:./+TZ-]+$/iu;

/**
 * Whether a column of a family can hold the value, matched this way.
 * @param {{ family: Family, whole: boolean }} column
 * @param {Match} match
 * @param {string} value
 */
export function holds(column, match, value) {
  if (value === "") return false;
  if (column.family === "text" || column.family === "json" || match === "regex") return true;
  if (column.family === "number")
    return match === "equals"
      ? (column.whole ? WHOLE : NUMBER).test(value)
      : NUMBER_PART.test(value);
  if (column.family === "uuid")
    return match === "equals" ? UUID.test(value) : UUID_PART.test(value) && !WHOLE.test(value);
  return DATE_PART.test(value) && /\d/u.test(value);
}

/**
 * The columns of a table the search looks in: of a chosen family, able to hold the value.
 * @param {EngineId} engine
 * @param {{ name: string, type: string }[]} columns
 * @param {{ families: Family[], match: Match, value: string }} options
 * @returns {Searched[]}
 */
export function searchedColumns(engine, columns, options) {
  return columns.flatMap((c) => {
    const found = familyOf(engine, c.type);
    if (!found || !options.families.includes(found.family)) return [];
    if (!holds(found, options.match, options.value)) return [];
    return [{ name: c.name, type: c.type, family: found.family, whole: found.whole }];
  });
}

/** A number written as jsonpath reads it: no leading `+`, a digit before a point. */
export function jsonNumber(/** @type {string} */ value) {
  const unsigned = value.replace(/^\+/u, "");
  return unsigned.replace(/^(-?)\./u, "$10.");
}

/** Whether a value is a number the engines read as one. */
export const isNumber = (/** @type {string} */ value) => NUMBER.test(value);
