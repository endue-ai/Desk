// A form's entries (one per argument, by position) from what a caller hands over, and what the
// form answers the palette and agents. A caller's `arguments` are by name (or $n), or a list in the
// order of the call's inputs: null is NULL, a list is a VARIADIC one's elements, { value, type }
// gives a polymorphic one its type, and an argument left out is DEFAULT where it has one. Pure.

import { formatArray } from "../../cell-editors/pg-array.js";
import { blankEntry, callOf, inputOf, labelOf } from "./call.js";
import { canRollBack, natureOf, refusalOf, titleOf } from "./guard.js";

/**
 * @typedef {import("./read.js").Routine} Routine
 * @typedef {import("./read.js").Arg} Arg
 * @typedef {import("./call.js").Entry} Entry
 * @typedef {import("./controller.js").RoutineState} RoutineState
 */

const MODES = { i: "IN", o: "OUT", b: "INOUT", v: "VARIADIC", t: "TABLE" };

/** An argument's mode as SQL writes it. */
export const modeOf = (/** @type {Arg} */ a) => MODES[a.mode];

/** A caller's value as text: a boolean as t or f, a list as an array, null kept apart. */
function textOf(/** @type {unknown} */ value) {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "t" : "f";
  if (Array.isArray(value))
    return formatArray(value.map((v) => (v === null ? null : (textOf(v) ?? ""))));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * The entries a caller's arguments make, over the form's own; undefined arguments keep the form's.
 * @param {Routine} r
 * @param {(Entry | undefined)[]} base
 * @param {unknown} given
 * @returns {(Entry | undefined)[]}
 */
export function entriesFrom(r, base, given) {
  if (given === undefined || given === null) return base;
  const inputs = r.args.filter((a) => inputOf(r, a) && a.mode !== "o");
  const list = Array.isArray(given) ? given : undefined;
  const named = /** @type {Record<string, unknown>} */ (list ? {} : given);
  if (!list && typeof given !== "object") throw new Error("arguments is an object or a list.");
  const known = new Set(inputs.map((a) => labelOf(r, a)));
  for (const key of Object.keys(named))
    if (!known.has(key))
      throw new Error(
        `${r.schema}.${r.name} has no argument ${key}: it takes ${[...known].join(", ") || "none"}.`,
      );
  if (list && list.length > inputs.length)
    throw new Error(`${r.schema}.${r.name} takes ${inputs.length} arguments, not ${list.length}.`);
  const out = [...base];
  inputs.forEach((a, i) => {
    const label = labelOf(r, a);
    const has = list ? i < list.length : Object.hasOwn(named, label);
    if (!has) {
      out[a.position - 1] = a.default !== null ? { choice: "default", value: "" } : blankEntry(a);
      return;
    }
    let value = list ? list[i] : named[label];
    /** @type {string | undefined} */
    let cast;
    if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
      const typed = /** @type {{ value: unknown, type?: unknown }} */ (value);
      cast = typeof typed.type === "string" ? typed.type : undefined;
      value = typed.value;
    }
    const text = textOf(value);
    out[a.position - 1] =
      text === null
        ? { choice: "null", value: "", ...(cast ? { cast } : {}) }
        : { choice: "value", value: text, ...(cast ? { cast } : {}) };
  });
  return out;
}

/** What the form shows, as the palette and agents read it. */
export function answerOf(/** @type {RoutineState} */ s) {
  const r = s.routine;
  if (!r) return { error: s.error || "Not read." };
  const { sql, problem } = callOf(r, s.entries);
  const refused = refusalOf(s.conn, r);
  return {
    routine: titleOf(r),
    returns: r.result || "nothing",
    runs: natureOf(r),
    arguments: r.args.map((a) => ({
      name: labelOf(r, a),
      mode: modeOf(a),
      type: a.type,
      ...(a.default !== null ? { default: a.default } : {}),
    })),
    statement: sql,
    rollback: s.rollback && canRollBack(r),
    ...(problem ? { problem } : {}),
    ...(refused ? { refused } : {}),
  };
}
