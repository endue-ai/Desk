// PostgreSQL parameters as bound values (PG-21, ADR 0353): the statement's `:name` and `$n` become
// `$1..$n` in the order they are first used (one number for every use of a name), and each answer
// travels beside the text as a value of the type the server inferred, so no value is ever part of
// the SQL. An answer written `=expression` is put into the text as SQL, as the prompt says. What
// the server's error position means in the sent text maps back to the person's. Pure.

import { builtinType } from "../cell-editors/pg-types.js";

/**
 * @typedef {import("./params.js").Param} Param
 * @typedef {{ from: number, to: number, at: number, end: number }} Shift
 *   A placeholder: `[from, to)` in the sent text stands where `[at, end)` was in the person's.
 * @typedef {import("../sql/split.js").Statement & {
 *   params?: (string | null)[], paramTypes?: number[], keys?: string[], shifts?: Shift[],
 * }} Bound
 *   A statement as it is sent: `params` its values by number, `paramTypes` their type OIDs (0 the
 *   server's inference), `keys` the person's name of each number, `shifts` its placeholders.
 */

/**
 * `text` with each parameter written `$k` (or, for a key in `sql`, that SQL).
 * @param {string} text
 * @param {Param[]} params In the order they stand in `text`.
 * @param {Record<string, string>} [sql] Expressions by key, put in as they are.
 * @returns {{ text: string, keys: string[], shifts: Shift[] }}
 */
export function numbered(text, params, sql = {}) {
  /** @type {string[]} */
  const keys = [];
  /** @type {Shift[]} */
  const shifts = [];
  let out = "";
  let at = 0;
  for (const param of params) {
    out += text.slice(at, param.start);
    let put = sql[param.key];
    if (put === undefined) {
      if (!keys.includes(param.key)) keys.push(param.key);
      put = `$${keys.indexOf(param.key) + 1}`;
    }
    shifts.push({ from: out.length, to: out.length + put.length, at: param.start, end: param.end });
    out += put;
    at = param.end;
  }
  return { text: out + text.slice(at), keys, shifts };
}

/** Where an offset of the sent text stands in the person's: inside a placeholder, at its start. */
export function origin(/** @type {Shift[] | undefined} */ shifts, /** @type {number} */ offset) {
  let back = offset;
  for (const shift of shifts ?? []) {
    if (offset < shift.from) break;
    back = offset < shift.to ? shift.at : shift.end + (offset - shift.to);
  }
  return back;
}

/**
 * An outcome with its error position put back where the person wrote it.
 * @template {{ error?: { position?: number } }} T
 * @param {Bound} statement
 * @param {T} outcome
 * @returns {T}
 */
export function placed(statement, outcome) {
  const position = outcome.error?.position;
  if (position === undefined || !statement.shifts) return outcome;
  return { ...outcome, error: { ...outcome.error, position: origin(statement.shifts, position) } };
}

/** What db.run and db.script take of a bound statement beside its text: its values and types. */
export const wireOf = (/** @type {Bound} */ statement) =>
  statement.params ? { params: statement.params, paramTypes: statement.paramTypes ?? [] } : {};

/** An answer as it is sent: NULL (any case) is null, anything else the text as typed. */
export const sentValue = (/** @type {string} */ typed) =>
  /^\s*null\s*$/iu.test(typed) ? null : typed;

/** Whether an answer is SQL to put in the text: `=expression`. */
export const isSql = (/** @type {string} */ typed) => typed.startsWith("=");

const INTEGER =
  /^\s*[+-]?(?:\d(?:_?\d)*|0[xX](?:_?[0-9a-fA-F])+|0[oO](?:_?[0-7])+|0[bB](?:_?[01])+)\s*$/u;
const DECIMAL =
  /^\s*[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d+)?\s*$/u;
const SPECIAL = /^\s*[+-]?(?:nan|inf|infinity)\s*$/iu;
const BOOLEAN = /^\s*(?:t(?:r(?:ue?)?)?|f(?:a(?:l(?:se?)?)?)?|y(?:es?)?|no?|on|of{1,2}|1|0)\s*$/iu;
/** @type {Record<string, [bigint, bigint, string]>} */
const RANGES = {
  int2: [-(2n ** 15n), 2n ** 15n - 1n, "smallint"],
  int4: [-(2n ** 31n), 2n ** 31n - 1n, "integer"],
  int8: [-(2n ** 63n), 2n ** 63n - 1n, "bigint"],
};

/**
 * Why a value does not fit its type, or "": integers (with their range), numeric and floats,
 * booleans, uuid and json are judged here; every other type by the server, whose Bind refuses a
 * value before the statement runs.
 * @param {string | null} value
 * @param {number} oid
 */
export function misfit(value, oid) {
  if (value === null) return "";
  const typname = builtinType(oid)?.typname ?? "";
  const range = RANGES[typname];
  if (range) {
    const [low, high, name] = range;
    if (!INTEGER.test(value)) return `${name} takes a whole number`;
    const plain = value.trim().replaceAll("_", "");
    if (/^[+-]?\d+$/u.test(plain) && (BigInt(plain) < low || BigInt(plain) > high))
      return `${name} holds ${low} to ${high}`;
    return "";
  }
  if (typname === "numeric" || typname === "float4" || typname === "float8")
    return DECIMAL.test(value) || SPECIAL.test(value) ? "" : `${typname} takes a number`;
  if (typname === "bool") return BOOLEAN.test(value) ? "" : "boolean takes true or false";
  if (typname === "uuid") {
    const hex = value
      .trim()
      .replace(/^\{(.*)\}$/u, "$1")
      .replaceAll("-", "");
    return /^[0-9a-f]{32}$/iu.test(hex) ? "" : "uuid takes 32 hexadecimal digits";
  }
  if (typname === "json" || typname === "jsonb") {
    try {
      JSON.parse(value);
      return "";
    } catch {
      return `${typname} takes a JSON value`;
    }
  }
  return "";
}

/**
 * A statement of the person's as it is sent: its placeholders numbered, the expressions put in,
 * the values beside it with the types the server inferred, by key.
 * @param {import("../sql/split.js").Statement} statement
 * @param {Param[]} params
 * @param {Record<string, string>} answers What the person typed, by key.
 * @param {Record<string, number>} types The inferred type OID by key.
 * @returns {Bound}
 */
export function bind(statement, params, answers, types) {
  /** @type {Record<string, string>} */
  const sql = {};
  for (const [key, typed] of Object.entries(answers))
    if (isSql(typed)) sql[key] = typed.slice(1).trim();
  const sent = numbered(statement.text, params, sql);
  return {
    ...statement,
    text: sent.text,
    params: sent.keys.map((key) => sentValue(answers[key] ?? "")),
    paramTypes: sent.keys.map((key) => types[key] ?? 0),
    keys: sent.keys,
    shifts: sent.shifts,
  };
}
