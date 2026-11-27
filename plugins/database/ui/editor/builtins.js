// The signatures of the common built-in functions words.js lists, for the signature help and for the
// columns of a built-in set-returning function in FROM: the person's own functions come from the
// schema cache, the server's own are not read (pg_catalog is a system schema). Each overload is its
// arguments as the server lists them and its result. Pure.

/** @typedef {import("../sql/lexer.js").Dialect} Dialect */
/** @typedef {{ name: string, args: string, result: string }} Builtin */

const COMMON = [
  "abs(x numeric) numeric",
  "avg(expression numeric) numeric",
  "coalesce(value anyelement, VARIADIC more anyelement[]) anyelement",
  "count(expression any) bigint",
  "lower(text text) text",
  "upper(text text) text",
  "max(expression any) any",
  "min(expression any) any",
  "nullif(value1 anyelement, value2 anyelement) anyelement",
  "round(x numeric) numeric",
  "round(x numeric, s integer) numeric",
  "sum(expression numeric) numeric",
  "length(text text) integer",
  "replace(string text, from text, to text) text",
  "substr(string text, start integer) text",
  "substr(string text, start integer, count integer) text",
  "trim(string text) text",
  "ltrim(string text, characters text) text",
  "rtrim(string text, characters text) text",
];

const POSTGRESQL = [
  "now() timestamp with time zone",
  "array_agg(expression anyelement) anyarray",
  "string_agg(value text, delimiter text) text",
  "jsonb_build_object(VARIADIC pairs any) jsonb",
  "json_agg(expression anyelement) json",
  "to_char(value timestamp with time zone, format text) text",
  "to_char(value numeric, format text) text",
  "date_trunc(field text, source timestamp with time zone) timestamp with time zone",
  "date_trunc(field text, source timestamp with time zone, zone text) timestamp with time zone",
  "date_trunc(field text, source interval) interval",
  "extract(field text, source timestamp with time zone) numeric",
  "generate_series(start integer, stop integer) SETOF integer",
  "generate_series(start integer, stop integer, step integer) SETOF integer",
  "generate_series(start timestamp with time zone, stop timestamp with time zone, step interval) SETOF timestamp with time zone",
  "greatest(value anyelement, VARIADIC more anyelement[]) anyelement",
  "least(value anyelement, VARIADIC more anyelement[]) anyelement",
  "concat(VARIADIC values any) text",
  "format(formatstr text, VARIADIC args any) text",
  "regexp_replace(source text, pattern text, replacement text) text",
  "regexp_replace(source text, pattern text, replacement text, flags text) text",
  "split_part(string text, delimiter text, n integer) text",
  "unnest(array anyarray) SETOF anyelement",
  "age(timestamp timestamp with time zone) interval",
  "age(timestamp timestamp with time zone, since timestamp with time zone) interval",
  "row_number() bigint",
  "rank() bigint",
  "dense_rank() bigint",
  "lag(value anyelement) anyelement",
  "lag(value anyelement, offset integer, default anyelement) anyelement",
  "lead(value anyelement) anyelement",
  "lead(value anyelement, offset integer, default anyelement) anyelement",
  "json_each(from_json json) TABLE(key text, value json)",
  "jsonb_each(from_json jsonb) TABLE(key text, value jsonb)",
  "jsonb_array_elements(from_json jsonb) SETOF jsonb",
];

/** `name(args) result` as a builtin. */
function parse(/** @type {string} */ line) {
  const open = line.indexOf("(");
  let depth = 0;
  let close = open;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  return {
    name: line.slice(0, open),
    args: line.slice(open + 1, close),
    result: line.slice(close + 1).trim(),
  };
}

/** @type {Map<string, Map<string, Builtin[]>>} */
const byDialect = new Map();

/** The built-in overloads of a function name in a dialect (PostgreSQL's list covers more). */
export function builtinsOf(/** @type {Dialect} */ dialect, /** @type {string} */ name) {
  let map = byDialect.get(dialect);
  if (!map) {
    map = new Map();
    for (const line of dialect === "postgresql" ? [...COMMON, ...POSTGRESQL] : COMMON) {
      const fn = parse(line);
      map.set(fn.name, [...(map.get(fn.name) ?? []), fn]);
    }
    byDialect.set(dialect, map);
  }
  return map.get(name.toLowerCase()) ?? [];
}

/** A list of arguments split at its top-level commas: `a integer, b numeric(10,2)`. */
export function argsOf(/** @type {string} */ text) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const MODES = new Set(["in", "out", "inout", "variadic"]);
/** Words that start a type, so `integer` alone is a type and not a parameter's name. */
const TYPE_STARTS = new Set(["double", "character", "timestamp", "time", "bit", "interval"]);

/** An argument's type: `a integer` → integer, `VARIADIC b text[]` → text[], `integer` → integer. */
export function argType(/** @type {string} */ arg) {
  const words = arg.split(/\s+/u).filter(Boolean);
  if (words[0] && MODES.has(words[0].toLowerCase())) words.shift();
  const def = words.findIndex((w) => /^default$/iu.test(w) || w === "=");
  if (def >= 0) words.length = def;
  if (words.length > 1 && !TYPE_STARTS.has((words[0] ?? "").toLowerCase())) words.shift();
  return words.join(" ");
}

/** Whether an argument takes the rest (VARIADIC). */
export const variadic = (/** @type {string} */ arg) => /^variadic\s/iu.test(arg.trim());
