// Submitting pending changes: their statements run as one transaction through the executor (so the
// read-only refusal, the production question and the password prompt apply as to any run). The
// first failure ends the run and nothing is kept: PostgreSQL's session sends ROLLBACK (engines/
// pg-session.js), sqlite3 (-bail) and the mysql client stop before COMMIT and the server rolls the
// open transaction back when the session ends. An UPDATE or DELETE that matched no row is said:
// the row changed or went since it was read. A refusal whose position falls in a cell's literal
// names that cell's column (PG-40). A guarded change (keyed by ctid or by its values, edit/tables.js)
// that did not change exactly one row fails on the server and says whether its row moved or could
// not be told apart; a foreign key that held against changes to several tables says so (PG-45). No
// DOM.

import { split } from "../sql/split.js";
import { planChanges } from "./pending.js";
import { MATCHED } from "./tables.js";

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
 *   failed?: Change, cell?: { row: number, col: number }, missed: Change[],
 * }} Submitted
 *   `failed` is the change whose statement the server refused and `cell` the cell its error points
 *   at; `missed` the updates and deletes that found no row (applied as nothing, the rest committed).
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
    const error = result.statements[at]?.error;
    const why = whyOf(failed, error, target);
    const position = error?.position;
    const span =
      position === undefined
        ? undefined
        : failed?.cells.find((c) => position >= c.start && position < c.end);
    const column = span ? target.columns[span.col]?.name : undefined;
    const where = failed ? `${describe(failed, set)}${column ? `, column ${column}` : ""}: ` : "";
    return {
      ok: false,
      plan,
      execution,
      ...(failed ? { failed } : {}),
      ...(failed && span ? { cell: { row: failed.row, col: span.col } } : {}),
      missed: [],
      message: `Rolled back, nothing was changed: ${where}${why}`,
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

/** What a failed statement's error means, in words. */
function whyOf(
  /** @type {Change | undefined} */ failed,
  /** @type {import("../engines/common.js").DbError | undefined} */ error,
  /** @type {Target} */ target,
) {
  const message = error?.message ?? "the run stopped before the end";
  const count = failed?.guarded && MATCHED.test(message) ? /"(\d+) rows/u.exec(message)?.[1] : "";
  if (count === "0")
    return `it matched no row of ${failed?.guarded}: the row moved or went since it was read (its ctid changes on every update). Read the rows again.`;
  if (count)
    return `it matched ${count} rows of ${failed?.guarded}: its values do not tell it apart from another row. Select a key or ctid to change one of them.`;
  if (error?.code === "23503" && (target.tables?.length ?? 0) > 1)
    return `${message}. A foreign key between ${target.tables?.map((t) => t.name).join(" and ")} holds against these changes in one Submit: submit them apart.`;
  return message;
}

/** A change as words: "row 3 (update)". */
export function describe(/** @type {Change} */ change, /** @type {ResultSet} */ set) {
  const what = change.kind === "insert" ? "new row" : `row ${change.row + 1}`;
  const n = change.kind === "insert" ? ` ${change.row - set.rows.length + 1}` : "";
  return `${what}${n} (${change.kind})`;
}
