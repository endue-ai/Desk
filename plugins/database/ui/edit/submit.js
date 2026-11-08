// Submitting pending changes: their statements run as one transaction through the executor (so the
// read-only refusal, the production question and the password prompt apply as to any run). The
// first failure ends the run and nothing is kept: psql sends ROLLBACK under --single-transaction
// and ON_ERROR_STOP, sqlite3 (-bail) and the mysql client stop before COMMIT and the server rolls
// the open transaction back when the session ends. An UPDATE or DELETE that matched no row is said:
// the row changed or went since it was read. No DOM.

import { split } from "../sql/split.js";
import { planChanges } from "./pending.js";

/**
 * @typedef {import("./pending.js").Target} Target
 * @typedef {import("./pending.js").Changes} Changes
 * @typedef {import("./pending.js").Change} Change
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../execute.js").Execution} Execution
 * @typedef {(conn: Connection, sql: string, options?: import("../execute.js").ExecuteOptions) => Promise<Execution>} Execute
 * @typedef {{
 *   ok: boolean, plan: Change[], execution: Execution, message: string,
 *   failed?: Change, missed: Change[],
 * }} Submitted
 *   `failed` is the change whose statement the server refused; `missed` the updates and deletes that
 *   found no row (applied as nothing, the rest committed).
 */

/**
 * The SQL a submit would run, one statement per line, for the preview.
 * @param {Target} target
 * @param {ResultSet} set
 * @param {Changes} changes
 */
export function previewSql(target, set, changes) {
  return planChanges(target, set, changes)
    .map((change) => `${change.sql};`)
    .join("\n");
}

/**
 * @param {{ execute: Execute, conn: Connection, target: Target, set: ResultSet, changes: Changes }} input
 * @returns {Promise<Submitted>}
 */
export async function submitChanges({ execute, conn, target, set, changes }) {
  const plan = planChanges(target, set, changes);
  if (plan.length === 0) throw new Error("No pending changes to submit.");
  const sql = plan.map((change) => change.sql).join(";\n");
  const statements = split(sql, target.dialect);
  if (statements.length !== plan.length)
    throw new Error("The changes did not make one statement each; nothing was run.");
  const execution = await execute(conn, sql, { mode: "transaction", statements });
  const { result } = execution;
  const count = `${plan.length} change${plan.length === 1 ? "" : "s"}`;
  if (result.error)
    return {
      ok: false,
      plan,
      execution,
      missed: [],
      message: `Nothing was changed: ${result.error.message}`,
    };
  const at = result.statements.findIndex((s) => s.error);
  if (at >= 0 || result.statements.some((s) => !s.ran)) {
    const failed = plan[at];
    const why = result.statements[at]?.error?.message ?? "the run stopped before the end";
    return {
      ok: false,
      plan,
      execution,
      ...(failed ? { failed } : {}),
      missed: [],
      message: `Rolled back, nothing was changed: ${failed ? `${describe(failed, set)}: ` : ""}${why}`,
    };
  }
  const missed = plan.filter(
    (change, i) => change.kind !== "insert" && result.statements[i]?.affected === 0,
  );
  const message = missed.length
    ? `Committed ${count}; ${missed.map((c) => describe(c, set)).join(", ")} matched no row: it changed or went since it was read.`
    : `Committed ${count} in one transaction.`;
  return { ok: true, plan, execution, missed, message };
}

/** A change as words: "row 3 (update)". */
export function describe(/** @type {Change} */ change, /** @type {ResultSet} */ set) {
  const what = change.kind === "insert" ? "new row" : `row ${change.row + 1}`;
  const n = change.kind === "insert" ? ` ${change.row - set.rows.length + 1}` : "";
  return `${what}${n} (${change.kind})`;
}
