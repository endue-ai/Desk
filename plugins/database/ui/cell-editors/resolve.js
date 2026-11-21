// The editor a column's cells get (PG-40), from its type: on PostgreSQL the catalog's reading of it
// (pg-types.js: the base type's internal name and category, enum labels, an array's element), or a
// built-in type OID's; otherwise the declared type's name (MySQL's enum('a','b') with its labels,
// SQLite's BLOB). A generated or always-identity column is fixed, with the reason; `auto` says what
// fills a column the server numbers or computes when a new row leaves it out (PG-43's duplicate).
// Pure.

import { binaryType, numericType } from "../edit/values.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./pg-types.js").TypeInfo} TypeInfo
 * @typedef {import("./pg-types.js").BaseType} BaseType
 * @typedef {"text" | "number" | "boolean" | "enum" | "date" | "time" | "timestamp" | "interval" | "json" | "array" | "bytes" | "uuid"} Kind
 * @typedef {"" | "int2" | "int4" | "int8" | "whole"} Integer
 * @typedef {{
 *   kind: Kind, type: string, cast: string, labels: string[], element?: Editor, zone: boolean,
 *   integer: Integer, nullable: boolean, hasDefault: boolean, fixed: string, timeZone: string,
 *   prefix: string, auto: "" | "identity" | "generated" | "serial",
 * }} Editor
 *   `type` as the catalog writes it; `cast` the type a PostgreSQL literal is cast to ("" for none);
 *   `integer` the range of a whole-number column; `fixed` why the column cannot change ("" when it
 *   can); `timeZone` the session's; `prefix` how bytes are written (\x, or 0x on MySQL and SQLite);
 *   `auto` what the server fills a new row's column with: an identity (always or by default), a
 *   generated column, a sequence's nextval() default ("serial"), or "" for none.
 * @typedef {{ typname: string, category: string, element?: BaseType | null, labels?: string[] }} Resolved
 * @typedef {{ name: string, type: string, nullable?: boolean, default?: string | null }} Column
 */

const BY_NAME = /** @type {Record<string, Kind>} */ ({
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  whole: "number",
  numeric: "number",
  float4: "number",
  float8: "number",
  oid: "number",
  json: "json",
  jsonb: "json",
  bytea: "bytes",
  uuid: "uuid",
  date: "date",
  time: "time",
  timetz: "time",
  timestamp: "timestamp",
  timestamptz: "timestamp",
  interval: "interval",
});
/** Kinds whose literal takes a cast: one that behaves as the column's own assignment would. */
const CAST = new Set([
  "enum",
  "json",
  "array",
  "uuid",
  "date",
  "time",
  "timestamp",
  "interval",
  "bytes",
]);
/** A cast to a character or bit type with a length cuts a longer value instead of refusing it. */
const CUTS = /\b(?:character|char|varchar|bpchar|bit|varbit)\b[^[]*\(/iu;

/** The editor's kind for a type's internal name and category. */
export function kindOf(/** @type {Resolved | undefined} */ type) {
  if (!type) return "text";
  const kind = BY_NAME[type.typname];
  if (kind) return kind;
  if (type.category === "E") return "enum";
  if (type.category === "A") return "array";
  return "text";
}

/**
 * @param {Dialect} dialect
 * @param {Column} column The catalog's column: its declared type, NOT NULL and default.
 * @param {TypeInfo} [info] PostgreSQL's reading of the type, when it was read.
 * @returns {Editor}
 */
export function editorOf(dialect, column, info) {
  const type = info?.type || column.type;
  const resolved = info
    ? { typname: info.typname, category: info.category, element: info.element, labels: info.labels }
    : declared(dialect, column.type);
  const nullable = info ? info.nullable : column.nullable !== false;
  const hasDefault = info
    ? info.hasDefault
    : column.default !== null && column.default !== undefined;
  const made = editorFor(dialect, type, resolved, info?.timeZone ?? "");
  return {
    ...made,
    nullable,
    hasDefault,
    fixed: fixedWhy(column.name, info),
    auto: autoOf(column, info),
  };
}

/** Give a target's columns of the table their editors (a result column of no table column, none). */
export function attachEditors(
  /** @type {import("../edit/pending.js").Target} */ target,
  /** @type {Column[]} */ tableColumns,
  /** @type {Map<string, TypeInfo>} */ types,
) {
  return {
    ...target,
    columns: target.columns.map((c) => {
      const column = c.known ? tableColumns.find((t) => t.name === c.name) : undefined;
      return column ? { ...c, editor: editorOf(target.dialect, column, types.get(c.name)) } : c;
    }),
  };
}

/** @returns {Editor} */
function editorFor(
  /** @type {Dialect} */ dialect,
  /** @type {string} */ type,
  /** @type {Resolved} */ resolved,
  /** @type {string} */ timeZone,
) {
  const kind = kindOf(resolved);
  const element =
    kind === "array"
      ? editorFor(
          dialect,
          type.replace(/\[\]$/u, ""),
          { ...(resolved.element ?? { typname: "text", category: "S" }), labels: resolved.labels },
          timeZone,
        )
      : undefined;
  const integer = /** @type {Integer} */ (
    ["int2", "int4", "int8", "whole"].includes(resolved.typname) ? resolved.typname : ""
  );
  return {
    kind,
    type,
    cast: dialect === "postgresql" && CAST.has(kind) && !CUTS.test(type) ? type : "",
    labels: kind === "enum" ? (resolved.labels ?? []) : [],
    ...(element ? { element } : {}),
    zone: resolved.typname === "timetz" || resolved.typname === "timestamptz",
    integer,
    nullable: true,
    hasDefault: false,
    fixed: "",
    timeZone,
    prefix: dialect === "postgresql" ? "\\x" : "0x",
    auto: "",
  };
}

/** What the server fills a new row's column with when it is left out. @returns {Editor["auto"]} */
function autoOf(/** @type {Column} */ column, /** @type {TypeInfo | undefined} */ info) {
  if (info?.identity) return "identity";
  if (info?.generated) return "generated";
  return /^nextval\(/iu.test(column.default ?? "") ? "serial" : "";
}

/** Why a column cannot change: generated, or an identity GENERATED ALWAYS. */
function fixedWhy(/** @type {string} */ name, /** @type {TypeInfo | undefined} */ info) {
  if (info?.generated === "s" || info?.generated === "v")
    return `${name} is generated always from an expression: the server computes it.`;
  if (info?.identity === "a")
    return `${name} is an identity column GENERATED ALWAYS: the server numbers its rows.`;
  return "";
}

const PG_NAMES = /** @type {[RegExp, string, string][]} */ ([
  [/^boolean$/u, "bool", "B"],
  [/^smallint$/u, "int2", "N"],
  [/^(?:integer|int)$/u, "int4", "N"],
  [/^bigint$/u, "int8", "N"],
  [/^(?:numeric|decimal)\b/u, "numeric", "N"],
  [/^(?:real|double precision)$/u, "float8", "N"],
  [/^jsonb$/u, "jsonb", "U"],
  [/^json$/u, "json", "U"],
  [/^bytea$/u, "bytea", "U"],
  [/^uuid$/u, "uuid", "U"],
  [/^date$/u, "date", "D"],
  [/^time(?:\(\d+\))? with time zone$/u, "timetz", "D"],
  [/^time(?:\(\d+\))?(?: without time zone)?$/u, "time", "D"],
  [/^timestamp(?:\(\d+\))? with time zone$/u, "timestamptz", "D"],
  [/^timestamp(?:\(\d+\))?(?: without time zone)?$/u, "timestamp", "D"],
  [/^interval\b/u, "interval", "T"],
]);

/** A type read from its declared name alone. @returns {Resolved} */
function declared(/** @type {Dialect} */ dialect, /** @type {string} */ type) {
  const text = type.trim();
  if (dialect === "postgresql") {
    if (text.endsWith("[]")) {
      const inner = declared(dialect, text.slice(0, -2));
      return { typname: `_${inner.typname}`, category: "A", element: inner };
    }
    const found = PG_NAMES.find(([re]) => re.test(text));
    return found ? { typname: found[1], category: found[2] } : { typname: text, category: "S" };
  }
  const enumOf = dialect === "mysql" ? /^enum\((.*)\)$/isu.exec(text) : null;
  if (enumOf)
    return {
      typname: "enum",
      category: "E",
      labels: [...(enumOf[1] ?? "").matchAll(/'((?:[^']|'')*)'/gu)].map((m) =>
        (m[1] ?? "").replaceAll("''", "'"),
      ),
    };
  if (binaryType(dialect, text)) return { typname: "bytea", category: "U" };
  if (dialect === "sqlite") return { typname: text, category: "S" };
  const lower = text.toLowerCase();
  if (lower === "json") return { typname: "json", category: "U" };
  if (lower === "date") return { typname: "date", category: "D" };
  if (/^(?:datetime|timestamp)\b/u.test(lower)) return { typname: "timestamp", category: "D" };
  const whole = /^(tinyint|smallint|mediumint|int|integer|bigint)\b/u.exec(lower);
  if (whole) {
    const name = lower.includes("unsigned")
      ? "whole"
      : ({ smallint: "int2", int: "int4", integer: "int4", bigint: "int8" }[whole[1] ?? ""] ??
        "whole");
    return { typname: name, category: "N" };
  }
  if (numericType(dialect, text)) return { typname: "numeric", category: "N" };
  return { typname: text, category: "S" };
}
