// A call's signatures: the overloads of the function the caret is inside, from the schema cache's
// routines (through the search path, or the schema written) and the built-in ones (builtins.js), with
// the argument the caret is in and the first overload that takes that many arguments. Pure.

import { argsOf, argType, builtinsOf, variadic } from "./builtins.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./caret.js").Call} Call
 * @typedef {{ name: string, args: string, result?: string, comment?: string, kind?: string }} Routine
 * @typedef {{ label: string, args: string[], result: string, comment: string }} Overload
 * @typedef {{ name: string, at: number, arg: number, active: number, overloads: Overload[] }} Signature
 *   `at` is the call's `(` in the statement; `arg` the argument the caret is in; `active` the
 *   overload shown first.
 * @typedef {{
 *   defaultSchema: string, path?: string[],
 *   routines?(schema: string): Routine[] | undefined,
 * }} RoutineView
 */

/** The overloads a function name has: the cache's first, else the built-in ones. */
export function overloadsOf(
  /** @type {string[]} */ names,
  /** @type {RoutineView} */ view,
  /** @type {Dialect} */ dialect,
) {
  const name = names.at(-1) ?? "";
  const schemas = names.length > 1 ? [names[0] ?? ""] : (view.path ?? [view.defaultSchema]);
  for (const schema of schemas) {
    const found = (view.routines?.(schema) ?? []).filter((r) => r.name === name);
    if (found.length) return found;
  }
  if (names.length > 1 && names[0] !== "pg_catalog") return [];
  return builtinsOf(dialect, name);
}

/** One overload as the signature help writes it. @returns {Overload} */
function overloadOf(/** @type {string} */ name, /** @type {Routine} */ routine) {
  const args = argsOf(routine.args);
  const result = routine.result ?? "";
  return {
    label: `${name}(${args.join(", ")})${result ? ` → ${result}` : ""}`,
    args,
    result,
    comment: routine.comment ?? "",
  };
}

/** Whether an overload takes an argument at `arg`. */
const takes = (/** @type {Overload} */ o, /** @type {number} */ arg) =>
  arg < o.args.length || o.args.some(variadic);

/**
 * @param {Call | null} call
 * @param {RoutineView} view
 * @param {Dialect} dialect
 * @returns {Signature | null}
 */
export function signatureOf(call, view, dialect) {
  if (!call) return null;
  const name = call.names.at(-1) ?? "";
  const overloads = overloadsOf(call.names, view, dialect).map((r) => overloadOf(name, r));
  if (overloads.length === 0) return null;
  const active = Math.max(
    0,
    overloads.findIndex((o) => takes(o, call.arg)),
  );
  return { name, at: call.open, arg: call.arg, active, overloads };
}

/** The type the argument at the caret takes in the overload shown, or "". */
export function expectedArg(/** @type {Signature | null} */ signature) {
  if (!signature) return "";
  const o = signature.overloads[signature.active];
  if (!o) return "";
  const arg = o.args[Math.min(signature.arg, o.args.length - 1)] ?? "";
  if (signature.arg >= o.args.length && !variadic(arg)) return "";
  const type = argType(arg);
  return variadic(arg) ? type.replace(/\[\]$/u, "") : type;
}
