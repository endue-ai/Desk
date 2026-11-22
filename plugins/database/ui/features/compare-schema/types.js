// A type as a DDL file writes it, read as the server labels it (PG-53): `int`, `int4` and `integer`
// are `integer`, `varchar(20)` is `character varying` of length 20, `timestamptz` is `timestamp with
// time zone`, `text[]` an array of `text`, `serial` an integer with a sequence, another schema's type
// `schema.name` (the table form's labels, features/table-design/types.js). A routine's arguments
// read as their types, as DROP FUNCTION takes them (the schema's own types unqualified). Pure.

import { factsFor } from "./model.js";
import { nameOf } from "./normalize.js";
import { typeSql } from "../table-design/types.js";
import { tokenize } from "../../sql/lexer.js";

/** What each alias is, as format_type writes it. */
const ALIASES = /** @type {Record<string, string>} */ ({
  int: "integer",
  int4: "integer",
  integer: "integer",
  int8: "bigint",
  bigint: "bigint",
  int2: "smallint",
  smallint: "smallint",
  serial: "integer",
  serial4: "integer",
  bigserial: "bigint",
  serial8: "bigint",
  smallserial: "smallint",
  serial2: "smallint",
  bool: "boolean",
  boolean: "boolean",
  float8: "double precision",
  "double precision": "double precision",
  float: "double precision",
  float4: "real",
  real: "real",
  varchar: "character varying",
  "character varying": "character varying",
  "char varying": "character varying",
  char: "character",
  character: "character",
  bpchar: "character",
  decimal: "numeric",
  numeric: "numeric",
  timestamp: "timestamp without time zone",
  "timestamp without time zone": "timestamp without time zone",
  timestamptz: "timestamp with time zone",
  "timestamp with time zone": "timestamp with time zone",
  time: "time without time zone",
  "time without time zone": "time without time zone",
  timetz: "time with time zone",
  "time with time zone": "time with time zone",
  varbit: "bit varying",
  "bit varying": "bit varying",
});
const SERIAL = /^(small|big)?serial[248]?$/u;
/** Types a length of 1 is given when none is written. */
const ONE = new Set(["character", "bit"]);

/**
 * @typedef {{ type: string, length: string, array: boolean, serial: boolean }} Typed
 *   `type` the server's label; `serial` that the column takes a sequence of its own.
 */

/**
 * A type's text read as the server labels it; `own` is the schema an unqualified name of `ours` is in.
 * @param {string} text
 * @param {{ own: string, ours?: Set<string> }} where
 * @returns {Typed}
 */
export function typed(text, { own, ours = new Set() }) {
  const tokens = tokenize(text, "postgresql").filter(
    (t) => t.type !== "space" && t.type !== "comment",
  );
  /** @type {string[]} */
  const names = [];
  let length = "";
  let array = false;
  let qualifier = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {import("../../sql/lexer.js").Token} */ (tokens[i]);
    if (t.text === "(") {
      const close = tokens.findIndex((x, j) => j > i && x.text === ")");
      length = tokens
        .slice(i + 1, close < 0 ? undefined : close)
        .map((x) => x.text)
        .join("");
      i = close < 0 ? tokens.length : close;
    } else if (t.text === "[") {
      array = true;
      while (i < tokens.length && tokens[i]?.text !== "]") i++;
    } else if (t.text === "." && names.length) qualifier = /** @type {string} */ (names.pop());
    else if (nameOf(t) === "array" && names.length) array = true;
    else {
      const n = nameOf(t);
      if (n !== undefined) names.push(n);
    }
  }
  const words = names.join(" ");
  const serial = !qualifier && SERIAL.test(words);
  if (qualifier && qualifier !== "pg_catalog")
    return { type: `${qualifier}.${words}`, length, array, serial };
  const label = ALIASES[words];
  if (label) {
    const precise = words === "float" && length && Number(length) <= 24 ? "real" : label;
    const len = words === "float" ? "" : length || (ONE.has(label) ? "1" : "");
    return { type: precise, length: len, array, serial };
  }
  if (!qualifier && ours.has(words)) return { type: `${own}.${words}`, length, array, serial };
  return { type: words, length, array, serial };
}

/** Multi-word types an argument's name must not be taken from. */
const PHRASES =
  /^(double precision|character varying|char varying|bit varying|(timestamp|time)( *\(\d+\))? with(out)? time zone)/u;

/**
 * A routine's arguments as their types: `a integer, OUT b text, c int DEFAULT 1` is `integer, integer`.
 * @param {string} args
 * @param {{ own: string, ours?: Set<string> }} where
 */
export function argTypes(args, where) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "(") depth++;
    else if (args[i] === ")") depth--;
    else if (args[i] === "," && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  const types = [];
  for (const raw of parts) {
    let text = raw.trim().replace(/\s+(DEFAULT\b|=).*$/isu, "");
    if (!text) continue;
    const mode = /^(IN|OUT|INOUT|VARIADIC)\s+/iu.exec(text);
    if (mode?.[1]?.toUpperCase() === "OUT") continue;
    if (mode) text = text.slice(mode[0].length);
    const lower = text.toLowerCase();
    const named = /^("(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)\s+(.+)$/isu.exec(text);
    if (named && !PHRASES.test(lower)) text = /** @type {string} */ (named[2]);
    const t = typed(text, where);
    const own = `${where.own}.`;
    const label = t.type.startsWith(own) ? t.type.slice(own.length) : t.type;
    const base = label
      .split(".")
      .map((p) => (/^[a-z_][a-z0-9_$ ]*$/u.test(p) ? p : `"${p.replaceAll('"', '""')}"`))
      .join(".");
    types.push(`${base}${t.array ? "[]" : ""}`);
  }
  return types.join(", ");
}

/** A type as the table form writes it: `character varying(20)`, `"app"."mood"[]`. */
export function typeDdl(/** @type {Typed} */ t) {
  const column = /** @type {any} */ ({ type: t.type });
  const facts = factsFor([
    { kind: "table", name: "", ddl: "", table: /** @type {any} */ ({ columns: [column] }) },
  ]);
  return typeSql(facts.types, t);
}
