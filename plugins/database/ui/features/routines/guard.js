// What a routine's run is held to (PG-56). Volatility decides: an IMMUTABLE or STABLE function only
// reads; a VOLATILE function and every procedure may change data, so they run as writes: refused on
// a read-only connection (rolled back too), asked with the environment named on production when the
// `confirm` setting is on, and an agent's request always asked. A write may run in a transaction
// rolled back at the end, except a procedure that commits or rolls back itself, which runs alone
// outside a transaction block. What cannot be called (an aggregate, a trigger function, one that
// takes `internal`) is refused in words. The executor asks for a procedure's CALL itself (it is a
// write by its verb), so this asks only where it would not. Pure.

import { oneLine } from "../../execute.js";
import { t } from "../../strings/index.js";
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
  if (r.prokind === "a")
    return t("features.routines.guard.isAnAggregateItRunsOver", { name: String(name) });
  if (r.prokind === "w")
    return t("features.routines.guard.isAWindowFunctionItRuns", { name: String(name) });
  if (r.returns.typname === "trigger" || r.returns.typname === "event_trigger")
    return t("features.routines.guard.isATriggerFunctionItsTrigger", { name: String(name) });
  const inner = r.args.find((a) => a.typtype === "p" && !polymorphic(a) && a.typname !== "void");
  if (inner)
    return t("features.routines.guard.takesOnlyTheServerCallsIt", {
      name: String(name),
      typname: String(inner.typname),
    });
  if (r.returns.typtype === "p" && SERVER_ONLY.has(r.returns.typname))
    return t("features.routines.guard.returnsOnlyTheServerCallsIt", {
      name: String(name),
      typname: String(r.returns.typname),
    });
  return "";
}

/** Whether a run may change data. */
export const writes = (/** @type {Routine} */ r) => r.kind === "procedure" || r.volatility === "v";

/** What the form says about how the routine runs. */
export function natureOf(/** @type {Routine} */ r) {
  if (r.kind === "procedure")
    return r.controls
      ? t("features.routines.guard.aProcedureMayChangeDataSo")
      : t("features.routines.guard.aProcedureMayChangeDataSo2");
  if (r.volatility === "i") return t("features.routines.guard.immutableItOnlyReadsSoIt");
  if (r.volatility === "s") return t("features.routines.guard.stableItOnlyReadsSoIt");
  return t("features.routines.guard.volatileItMayChangeDataSo");
}

/** Whether "run in a transaction and roll back" is offered. */
export const canRollBack = (/** @type {Routine} */ r) => writes(r) && !r.controls;

/** What a rolled-back run undoes, said plainly. */
export const ROLLBACK_WORDS = t("features.routines.guard.itRunsBetweenBeginAndRollback");

/** Why a run does not start on this connection, or "". */
export function refusalOf(/** @type {Conn} */ conn, /** @type {Routine} */ r) {
  const why = uncallable(r);
  if (why) return why;
  if (conn.readOnly && writes(r)) {
    const what = r.kind === "procedure" ? "is a procedure" : "is VOLATILE";
    return t("features.routines.guard.isReadOnlySoItMay", {
      name: String(conn.name),
      schema: String(r.schema),
      name2: String(r.name),
      what: String(what),
    });
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
    ...(how.agent
      ? [
          t("features.routines.guard.anAgentAsksToRun", {
            schema: String(r.schema),
            name: String(r.name),
          }),
        ]
      : []),
    ...(production
      ? [t("features.routines.guard.isTaggedProduction", { name: String(conn.name) })]
      : []),
    t("features.routines.guard.itMayChangeData", {
      schema: String(r.schema),
      name: String(r.name),
      value: String(
        r.kind === "procedure"
          ? t("features.routines.guard.isAProcedure")
          : t("features.routines.guard.isVolatile"),
      ),
    }),
    ...(how.rollback ? [t("features.routines.guard.itRunsInATransactionRolled")] : []),
    oneLine(sql),
  ];
  return {
    title: t("features.routines.guard.runThisStatementOn", { name: String(conn.name) }),
    reasons,
  };
}
