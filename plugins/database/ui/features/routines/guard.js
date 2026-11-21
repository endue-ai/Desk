// What a routine's run is held to (PG-56). Volatility decides: an IMMUTABLE or STABLE function only
// reads; a VOLATILE function and every procedure may change data, so they run as writes: refused on
// a read-only connection (rolled back too), asked with the environment named on production when the
// `confirm` setting is on, and an agent's request always asked. A write may run in a transaction
// rolled back at the end, except a procedure that commits or rolls back itself, which runs alone
// outside a transaction block. What cannot be called (an aggregate, a trigger function, one that
// takes `internal`) is refused in words. The executor asks for a procedure's CALL itself (it is a
// write by its verb), so this asks only where it would not. Pure.

import { oneLine } from "../../execute.js";
import { polymorphic } from "./call.js";

/**
 * @typedef {import("./read.js").Routine} Routine
 * @typedef {Pick<import("../../engines/common.js").Connection, "name" | "readOnly" | "tag">} Conn
 */

/** Pseudo-types only the server passes or gets back. */
const SERVER_ONLY = new Set([
  "internal",
  "cstring",
  "language_handler",
  "fdw_handler",
  "table_am_handler",
  "index_am_handler",
  "tsm_handler",
  "pg_ddl_command",
  "opaque",
]);

/** The routine as a phrase: "Function public.f(a integer)". */
export function titleOf(/** @type {Routine} */ r) {
  const kind = r.kind === "procedure" ? "Procedure" : "Function";
  return `${kind} ${r.schema}.${r.name}(${r.identity})`;
}

/** Why a routine cannot be called from the form, or "". */
export function uncallable(/** @type {Routine} */ r) {
  const name = `${r.schema}.${r.name}`;
  if (r.prokind === "a") return `${name} is an aggregate: it runs over the rows of a query.`;
  if (r.prokind === "w") return `${name} is a window function: it runs over a query's window.`;
  if (r.returns.typname === "trigger" || r.returns.typname === "event_trigger")
    return `${name} is a trigger function: its trigger runs it, not a call.`;
  const inner = r.args.find((a) => a.typtype === "p" && !polymorphic(a) && a.typname !== "void");
  if (inner) return `${name} takes ${inner.typname}: only the server calls it.`;
  if (r.returns.typtype === "p" && SERVER_ONLY.has(r.returns.typname))
    return `${name} returns ${r.returns.typname}: only the server calls it.`;
  return "";
}

/** Whether a run may change data. */
export const writes = (/** @type {Routine} */ r) => r.kind === "procedure" || r.volatility === "v";

/** What the form says about how the routine runs. */
export function natureOf(/** @type {Routine} */ r) {
  if (r.kind === "procedure")
    return r.controls
      ? "A procedure may change data, so it runs as a write. Its source commits or rolls back: it runs alone, outside a transaction block, and cannot be rolled back."
      : "A procedure may change data, so it runs as a write.";
  if (r.volatility === "i") return "IMMUTABLE: it only reads, so it runs as a read.";
  if (r.volatility === "s") return "STABLE: it only reads, so it runs as a read.";
  return "VOLATILE: it may change data, so it runs as a write.";
}

/** Whether "run in a transaction and roll back" is offered. */
export const canRollBack = (/** @type {Routine} */ r) => writes(r) && !r.controls;

/** What a rolled-back run undoes, said plainly. */
export const ROLLBACK_WORDS =
  "It runs between BEGIN and ROLLBACK: what it writes in this database is undone at the end. A sequence it advances stays advanced, and what it does outside the database is not undone.";

/** Why a run does not start on this connection, or "". */
export function refusalOf(/** @type {Conn} */ conn, /** @type {Routine} */ r) {
  const why = uncallable(r);
  if (why) return why;
  if (conn.readOnly && writes(r)) {
    const what = r.kind === "procedure" ? "is a procedure" : "is VOLATILE";
    return `${conn.name} is read-only: ${r.schema}.${r.name} ${what}, so it may change data; it does not run there, not even rolled back.`;
  }
  return "";
}

/**
 * The question to ask before a run, or null when nothing is asked here (the executor asks for a
 * procedure's CALL run as it is).
 * @param {Conn} conn
 * @param {Routine} r
 * @param {string} sql
 * @param {{ rollback: boolean, agent: boolean, confirm: boolean }} how
 */
export function questionOf(conn, r, sql, how) {
  if (!writes(r)) return null;
  if (r.kind === "procedure" && !how.rollback) return null;
  const production = conn.tag === "production" && !how.rollback && how.confirm;
  if (!how.agent && !production) return null;
  const reasons = [
    ...(how.agent ? [`An agent asks to run ${r.schema}.${r.name}.`] : []),
    ...(production ? [`${conn.name} is tagged production.`] : []),
    `${r.schema}.${r.name} ${r.kind === "procedure" ? "is a procedure" : "is VOLATILE"}: it may change data.`,
    ...(how.rollback ? ["It runs in a transaction rolled back at the end."] : []),
    oneLine(sql),
  ];
  return { title: `Run this statement on ${conn.name}?`, reasons };
}
