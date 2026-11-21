// The call a routine's form runs (PG-56): `SELECT f(...)` for a function of one value, `SELECT *
// FROM f(...)` for one that returns a set, a row type or OUT columns, and `CALL p(...)` for a
// procedure, whose OUT arguments are passed as NULL. Arguments with names go by name (`a => 1`),
// those before the last unnamed one by position; one left to its DEFAULT is left out, by name
// anywhere and by position only at the end. VARIADIC is the array of its elements. Every literal
// is quoted by quote.js, never pasted, and cast to its argument's declared type, so the call
// resolves to the signature chosen. Pure.

import { boolOf } from "../../cell-editors/boolean.js";
import { checkValue } from "../../cell-editors/values.js";
import { RESERVED } from "../../editor/words.js";
import { quoteText, readableName } from "../../sql/quote.js";
import { POLYMORPHIC } from "./read.js";

/**
 * @typedef {import("./read.js").Routine} Routine
 * @typedef {import("./read.js").Arg} Arg
 * @typedef {{ choice: "value" | "null" | "default", value: string, error?: string, cast?: string }} Entry
 *   An argument's value as the form holds it: the text its editor checked (`error` when the editor
 *   refused what was typed), NULL or DEFAULT; `cast` the type a polymorphic one is given as.
 */

const UNSIGNED = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
/** A type name the person may write: a name (schema-qualified), words, a typmod, array brackets. */
const TYPE_NAME =
  /^(?:[A-Za-z_][A-Za-z0-9_$]*\.)?[A-Za-z_][A-Za-z0-9_$]*(?: [A-Za-z_][A-Za-z0-9_$]*)*(?:\(\d+(?:, ?\d+)?\))?(?:\[\])*$/u;
/** A call longer than this puts each argument on its own line. */
const LINE = 100;

/** Whether an argument is given in the call: a function's IN, INOUT and VARIADIC, and a procedure's OUT too. */
export const inputOf = (/** @type {Routine} */ r, /** @type {Arg} */ a) =>
  a.mode === "i" || a.mode === "b" || a.mode === "v" || (r.kind === "procedure" && a.mode === "o");

/** Whether an argument's type is a polymorphic one, given as the type the person names. */
export const polymorphic = (/** @type {Arg} */ a) =>
  a.typtype === "p" && POLYMORPHIC.has(a.typname);

/** How the form names an argument: its name, else $n by its place among the inputs. */
export function labelOf(/** @type {Routine} */ r, /** @type {Arg} */ a) {
  if (a.name) return a.name;
  const inputs = r.args.filter((x) => inputOf(r, x) && x.mode !== "o");
  const at = inputs.indexOf(a);
  return at >= 0 ? `$${at + 1}` : `column ${a.position}`;
}

/** An argument's entry when the form has none: DEFAULT where it has one, else an empty value. */
export const blankEntry = (/** @type {Arg} */ a) =>
  /** @type {Entry} */ ({ choice: a.default !== null ? "default" : "value", value: "" });

/** The type a literal is cast to, or why the person's type is refused. */
function castOf(/** @type {Arg} */ a, /** @type {Entry} */ e, /** @type {string} */ label) {
  if (!polymorphic(a)) return { type: a.type };
  const type = (e.cast ?? "").trim() || (a.mode === "v" ? "text[]" : "text");
  if (!TYPE_NAME.test(type))
    return { error: `${label}: ${type} is not a type name, as text, integer or public.mood.` };
  if (a.mode === "v" && !type.endsWith("[]"))
    return { error: `${label} is VARIADIC: name an array type, as text[] or integer[].` };
  return { type };
}

/**
 * The literal of one argument: NULL or a quoted value, cast to its type; or why it has none.
 * @param {Arg} a
 * @param {Entry} e
 * @param {string} label
 * @returns {{ sql: string } | { error: string }}
 */
export function literalOf(a, e, label) {
  const cast = castOf(a, e, label);
  if ("error" in cast) return cast;
  const { type } = cast;
  if (e.choice === "null") return { sql: `NULL::${type}` };
  if (e.error) return { error: `${label}: ${e.error}` };
  const done = checkValue(a.editor, e.value);
  if ("error" in done) return { error: `${label}: ${done.error}` };
  const value = done.value;
  if (a.editor.kind === "boolean") {
    const word = boolOf(value) === "t" ? "TRUE" : "FALSE";
    return { sql: type === "boolean" ? word : `${word}::${type}` };
  }
  if (a.editor.kind === "number" && UNSIGNED.test(value)) return { sql: `${value}::${type}` };
  return { sql: `${quoteText("postgresql", value)}::${type}` };
}

/** A name as SQL reads it back: quoted only where it must be. */
const nameOf = (/** @type {string} */ name) => readableName("postgresql", "", name, RESERVED);

/**
 * The call of a routine with the form's entries (by argument position), or what stops it.
 * @param {Routine} r
 * @param {(Entry | undefined)[]} entries
 * @returns {{ sql: string, problem: string }}
 */
export function callOf(r, entries) {
  const inputs = r.args.filter((a) => inputOf(r, a));
  const lastUnnamed = inputs.reduce((at, a, i) => (a.name ? at : i), -1);
  /** @type {string[]} */
  const pieces = [];
  /** @type {string[]} */
  const problems = [];
  let leftOut = "";
  inputs.forEach((a, i) => {
    const label = labelOf(r, a);
    const byName = i > lastUnnamed;
    const e = entries[a.position - 1] ?? blankEntry(a);
    /** @type {string} */
    let value;
    if (r.kind === "procedure" && a.mode === "o") value = `NULL::${a.type}`;
    else if (e.choice === "default") {
      if (a.default === null) problems.push(`${label} has no default: give it a value or NULL.`);
      else if (!byName) leftOut ||= label;
      return;
    } else {
      const done = literalOf(a, e, label);
      if ("error" in done) {
        problems.push(done.error);
        return;
      }
      value = done.sql;
    }
    if (!byName && leftOut) {
      problems.push(
        `${leftOut} is left to its default, so ${label} after it must be too: an argument without a name is given by its place.`,
      );
      return;
    }
    const variadic = a.mode === "v" ? "VARIADIC " : "";
    pieces.push(byName ? `${variadic}${nameOf(a.name)} => ${value}` : `${variadic}${value}`);
  });
  const fn = readableName("postgresql", r.schema, r.name, RESERVED);
  const head = r.kind === "procedure" ? "CALL" : returnsRows(r) ? "SELECT * FROM" : "SELECT";
  const one = `${head} ${fn}(${pieces.join(", ")})`;
  const sql =
    one.length <= LINE || pieces.length < 2
      ? one
      : `${head} ${fn}(\n    ${pieces.join(",\n    ")}\n)`;
  return { sql, problem: problems[0] ?? "" };
}

/**
 * Whether a function's result is rows to select FROM: a set, a row type, or OUT and TABLE columns.
 * A bare `record` without them needs a column list the form does not ask for, so it is selected.
 * @param {Routine} r
 */
export function returnsRows(r) {
  const columns = r.args.some((a) => a.mode === "o" || a.mode === "b" || a.mode === "t");
  if (r.returns.typname === "record" && !columns) return false;
  return r.returnsSet || r.returns.typtype === "c" || columns;
}
