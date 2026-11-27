// Submitting pending changes: their statements run as one transaction through the executor (so the
// read-only refusal, the production question and the password prompt apply as to any run). The
// first failure ends the run and nothing is kept: PostgreSQL's session sends ROLLBACK (engines/
// pg-session.js), sqlite3 (-bail) and the mysql client stop before COMMIT and the server rolls the
// open transaction back when the session ends. An UPDATE or DELETE that matched no row is said:
// the row changed or went since it was read. A refusal whose position falls in a cell's literal
// names that cell's column (PG-40). A guarded change (keyed by ctid or by its values, edit/tables.js)
// that did not change exactly one row fails on the server and says whether its row moved or could
// not be told apart; a foreign key that held against changes to several tables says so (PG-45). A
// session that ended under a Submit (PG-105, ADR 0355) is said for what it means: before COMMIT
// nothing was committed, during COMMIT it is unknown whether the server committed, with how to check;
// the changes stay pending either way. No DOM.

import { split } from "../sql/split.js";
import { t as messageText } from "../strings/index.js";
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
  if (plan.length === 0) throw new Error(messageText("edit.submit.noPendingChangesToSubmit"));
  const sql = plan.map((change) => change.sql).join(";\n");
  const statements = split(sql, target.dialect);
  if (statements.length !== plan.length)
    throw new Error(messageText("edit.submit.theChangesDidNotMakeOne"));
  const execution = await execute(conn, sql, { mode: "transaction", statements });
  const { result } = execution;
  const count = `${plan.length} change${plan.length === 1 ? "" : "s"}`;
  const allRan = plan.every((_, i) => result.statements[i]?.ran && !result.statements[i]?.error);
  if (result.error && allRan && ended(result.error))
    return {
      ok: false,
      plan,
      execution,
      missed: [],
      message: messageText("edit.submit.unknownWhetherTheServerCommittedThe", {
        count: String(count),
      }),
    };
  if (result.error)
    return {
      ok: false,
      plan,
      execution,
      missed: [],
      message: messageText("edit.submit.nothingWasChanged", {
        message: String(result.error.message),
      }),
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
    const gone = error && ended(error);
    return {
      ok: false,
      plan,
      execution,
      ...(failed ? { failed } : {}),
      ...(failed && span ? { cell: { row: failed.row, col: span.col } } : {}),
      missed: [],
      message: gone
        ? messageText("edit.submit.notCommittedTheSessionEndedAt", {
            value: String(failed ? describe(failed, set) : messageText("edit.submit.aChange")),
            message: String(error.message),
          })
        : messageText("edit.submit.rolledBackNothingWasChanged", {
            where: String(where),
            why: String(why),
          }),
    };
  }
  const missed = plan.filter(
    (change, i) => change.kind !== "insert" && result.statements[i]?.affected === 0,
  );
  const message = missed.length
    ? messageText("edit.submit.committedMatchedNoRowItChanged", {
        count: String(count),
        value: String(missed.map((c) => describe(c, set)).join(", ")),
      })
    : messageText("edit.submit.committedInOneTransaction", { count: String(count) });
  return { ok: true, plan, execution, missed, message };
}

/** Whether an error says the session ended: the server's (class 08, 57P01-57P03) or the call's. */
function ended(/** @type {import("../engines/common.js").DbError} */ error) {
  const code = error.code ?? "";
  if (/^08|^57P0[1-3]$/u.test(code)) return true;
  return error.kind === "client" && /session (has )?ended|^COMMIT: /iu.test(error.message);
}

/** What a failed statement's error means, in words. */
function whyOf(
  /** @type {Change | undefined} */ failed,
  /** @type {import("../engines/common.js").DbError | undefined} */ error,
  /** @type {Target} */ target,
) {
  const message = error?.message ?? messageText("edit.submit.theRunStoppedBeforeTheEnd");
  const count = failed?.guarded && MATCHED.test(message) ? /"(\d+) rows/u.exec(message)?.[1] : "";
  if (count === "0")
    return messageText("edit.submit.itMatchedNoRowOfThe", { value: String(failed?.guarded) });
  if (count)
    return messageText("edit.submit.itMatchedRowsOfItsValues", {
      count: String(count),
      value: String(failed?.guarded),
    });
  if (error?.code === "23503" && (target.tables?.length ?? 0) > 1)
    return messageText("edit.submit.aForeignKeyBetweenHoldsAgainst", {
      message: String(message),
      value: String(target.tables?.map((t) => t.name).join(" and ")),
    });
  return message;
}

/** A change as words: "row 3 (update)". */
export function describe(/** @type {Change} */ change, /** @type {ResultSet} */ set) {
  const what = change.kind === "insert" ? "new row" : `row ${change.row + 1}`;
  const n = change.kind === "insert" ? ` ${change.row - set.rows.length + 1}` : "";
  return `${what}${n} (${change.kind})`;
}
