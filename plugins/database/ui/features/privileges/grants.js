// GRANT and REVOKE from the matrix's changes (PG-54): for each grantee (and column) the privileges
// it loses, then those whose grant option it loses, then those it gains, then those it gains with
// their grant option, one statement each, every name quoted and PUBLIC bare; CASCADE on a revoke
// only when chosen. Default privileges are the same changes as ALTER DEFAULT PRIVILEGES for an
// owner, in a schema or every one, on a kind. Pure.

import { qualified, quoteName } from "../../sql/quote.js";
import { DEFAULT_KINDS, kindOf } from "./kinds.js";

/**
 * @typedef {import("./acl.js").Change} Change
 * @typedef {import("./kinds.js").Target} Target
 */

const PG = "postgresql";
export const q = (/** @type {string} */ name) => quoteName(PG, name);
/** A grantee as GRANT names it: PUBLIC bare, a role quoted. */
export const granteeOf = (/** @type {string} */ name) => (name === "PUBLIC" ? "PUBLIC" : q(name));

/**
 * What GRANT ... ON names an object by: `TABLE "s"."t"`, `FUNCTION "s"."f"(integer)`.
 * @param {Target} target
 * @param {string[]} [routine] A routine's name and identity arguments, as read.
 */
export function objectRef(target, routine = []) {
  const row = kindOf(target.kind);
  if (!row) throw new Error(`A ${target.kind} has no privileges of its own.`);
  if (row.routine) {
    const [name, args] = routine;
    if (name === undefined || args === undefined)
      throw new Error(`The arguments of ${target.name} were not read.`);
    return `${row.on} ${qualified(PG, target.schema, name)}(${args})`;
  }
  if (row.level || target.kind === "schema") return `${row.on} ${q(target.name)}`;
  return `${row.on} ${qualified(PG, target.schema, target.name)}`;
}

/** The four steps of a grantee's changes, in the order they run. */
const STEPS = /** @type {const} */ (["revoke", "revoke option", "grant", "grant option"]);
const stepOf = (/** @type {Change} */ c) =>
  c.to === "none"
    ? "revoke"
    : c.to === "granted"
      ? c.from === "option"
        ? "revoke option"
        : "grant"
      : "grant option";

/**
 * Each statement's head and tail around ON ... for a group of privileges.
 * @param {(typeof STEPS)[number]} step
 * @param {string} list The privileges, a column's with it: `SELECT ("name")`.
 * @param {string} grantee
 * @param {boolean} cascade
 * @param {string} on
 */
function statement(step, list, grantee, cascade, on) {
  const to = granteeOf(grantee);
  const tail = cascade ? " CASCADE" : "";
  if (step === "revoke") return `REVOKE ${list} ON ${on} FROM ${to}${tail};`;
  if (step === "revoke option")
    return `REVOKE GRANT OPTION FOR ${list} ON ${on} FROM ${to}${tail};`;
  if (step === "grant") return `GRANT ${list} ON ${on} TO ${to};`;
  return `GRANT ${list} ON ${on} TO ${to} WITH GRANT OPTION;`;
}

/** The changes grouped by grantee, column and step, in the matrix's order. */
function groups(/** @type {Change[]} */ changes) {
  /** @type {Map<string, { grantee: string, column: string, step: (typeof STEPS)[number], privileges: string[] }>} */
  const by = new Map();
  for (const c of changes) {
    const step = stepOf(c);
    const key = `${c.grantee}\u0000${c.column}\u0000${STEPS.indexOf(step)}`;
    const group = by.get(key) ?? { grantee: c.grantee, column: c.column, step, privileges: [] };
    group.privileges.push(c.privilege);
    by.set(key, group);
  }
  const first = (/** @type {{ grantee: string, column: string }} */ g) =>
    changes.findIndex((c) => c.grantee === g.grantee && c.column === g.column);
  return [...by.values()].sort(
    (a, b) => first(a) - first(b) || STEPS.indexOf(a.step) - STEPS.indexOf(b.step),
  );
}

/**
 * The script of an object's changes; an Error when there are none.
 * @param {string} on What GRANT names it by (objectRef).
 * @param {Change[]} changes
 * @param {{ cascade?: boolean }} [options]
 */
export function grantScript(on, changes, options = {}) {
  if (changes.length === 0) throw new Error("Nothing changed: press a cell of the matrix first.");
  return groups(changes)
    .map((g) => {
      const list = g.column
        ? g.privileges.map((p) => `${p} (${q(g.column)})`).join(", ")
        : g.privileges.join(", ");
      const cascade = options.cascade === true && g.step.startsWith("revoke");
      return statement(g.step, list, g.grantee, cascade, on);
    })
    .join("\n");
}

/**
 * The script of default privileges' changes for an owner, a schema ("" for every one) and a kind.
 * @param {{ owner: string, schema: string, letter: string }} entry
 * @param {Change[]} changes
 */
export function defaultScript(entry, changes) {
  const kind = Object.hasOwn(DEFAULT_KINDS, entry.letter)
    ? DEFAULT_KINDS[/** @type {keyof typeof DEFAULT_KINDS} */ (entry.letter)]
    : undefined;
  if (!kind) throw new Error(`Default privileges have no kind ${entry.letter}.`);
  if (!entry.owner.trim()) throw new Error("Name the role whose new objects these are.");
  if (kind.on === "SCHEMAS" && entry.schema)
    throw new Error("Default privileges on schemas are for every schema: leave the schema empty.");
  if (changes.length === 0) throw new Error("Nothing changed: press a cell of the matrix first.");
  const head = `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(entry.owner)}${entry.schema ? ` IN SCHEMA ${q(entry.schema)}` : ""}`;
  return groups(changes)
    .map((g) => {
      const body = statement(g.step, g.privileges.join(", "), g.grantee, false, kind.on);
      // ALTER DEFAULT PRIVILEGES writes the kind without ON's object: `GRANT SELECT ON TABLES`.
      return `${head} ${body}`;
    })
    .join("\n");
}
