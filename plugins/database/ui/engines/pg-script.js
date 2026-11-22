// A run's statements on one PostgreSQL session (db.run, ADR 0281): each statement's pages up to the
// row limit (the rest closed), its error and notices, the statement timeout's backstop (cancel, then
// close), and the run's mode: BEGIN and COMMIT or ROLLBACK around the script, or, on a console's
// session already in a transaction (PG-02, ADR 0320), a savepoint, so neither ends the person's
// transaction; inside a failed transaction those modes are refused. Each page's ReadyForQuery state
// goes to the job, and a session the run found gone is noted on it. No DOM.

import { ROLLBACK_FIRST } from "../session/words.js";
import { endedBy, notRun } from "./common.js";
import { affectedOf, CANCELED, errorOf, setOf } from "./pg-result.js";

/**
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./common.js").StatementOutcome} StatementOutcome
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("@endue-ai/bridge").DbPage} Page
 * @typedef {import("@endue-ai/bridge").DbTransaction} Transaction
 * @typedef {{
 *   statements: Statement[], maxRows: number, timeoutMs: number, password?: string,
 *   mode: "run" | "transaction" | "dry-run",
 *   session?: import("../session/keeper.js").Owner, agent?: boolean, signal?: AbortSignal,
 *   quiet?: boolean,
 * }} Plan
 *   `session` runs on that owner's kept session (a console's, a table view's); `agent` is an
 *   agent's run, which the console's Cancel leaves alone; `signal` cancels this run alone: its
 *   statement on its session, nothing after it (a kept session stays open); `quiet` asks for no
 *   key passphrase (ADR 0331).
 * @typedef {{
 *   sessionId?: string, running: boolean, cancelled: boolean, timedOut: boolean,
 *   owner?: string, agent: boolean, transaction?: Transaction, ended?: string,
 * }} Job
 *   `transaction` is the last state a page reported; `ended` why the session went during the run.
 */

/** How the client waits past the statement timeout before it cancels, then closes. */
export const BACKSTOP_MS = 5000;
export const GRACE_MS = 1000;
const PAGE_ROWS = 10_000;
/** The savepoint a run in a transaction or a dry run takes inside an open transaction. */
export const SAVEPOINT = "endue_desk";
const PLAIN = { begin: "BEGIN", commit: ["COMMIT"], rollback: ["ROLLBACK"] };
const NESTED = {
  begin: `SAVEPOINT ${SAVEPOINT}`,
  commit: [`RELEASE SAVEPOINT ${SAVEPOINT}`],
  rollback: [`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`, `RELEASE SAVEPOINT ${SAVEPOINT}`],
};
/** Bridge errors that say the session is gone. */
const GONE = new Set(["not_found", "io_error"]);

const textOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {{
 *   call(method: string, params: Record<string, unknown>): Promise<any>,
 *   sinks: Map<string, string[]>,
 *   setTimer(fn: () => void, ms: number): unknown, clearTimer(timer: unknown): void,
 * }} deps
 */
export function createScript({ call, sinks, setTimer, clearTimer }) {
  /** A page's state, and whether its error ends the session (the server's FATAL). */
  const heard = (/** @type {Job} */ job, /** @type {Page | undefined} */ page) => {
    if (page?.transaction) job.transaction = page.transaction;
    if (page?.error?.severity === "FATAL") job.ended = page.error.message;
    return page;
  };
  /** A call that failed: the session gone is noted on the job. */
  const failed = (/** @type {Job} */ job, /** @type {unknown} */ error) => {
    const code = /** @type {{ code?: string }} */ (error)?.code ?? "";
    if (GONE.has(code)) job.ended = `The session ended during the run: ${textOf(error)}`;
  };

  /** The statement timeout passed by the backstop: cancel, then end the session. */
  const stall = (/** @type {Job} */ job) => {
    job.timedOut = true;
    const sessionId = job.sessionId;
    void call("db.cancel", { sessionId }).catch(() => {});
    setTimer(() => void call("db.close", { sessionId }).catch(() => {}), GRACE_MS);
  };

  /**
   * One statement on the job's session: its pages up to `maxRows`, then the rest closed.
   * @param {Job} job @param {Statement} statement @param {number} index @param {Plan} plan
   * @returns {Promise<StatementOutcome>}
   */
  const one = async (job, statement, index, plan) => {
    const { maxRows, timeoutMs } = plan;
    const sessionId = job.sessionId;
    /** @type {string[]} */
    const notices = [];
    sinks.set(/** @type {string} */ (sessionId), notices);
    const rowsOf = (/** @type {number} */ have) => Math.max(1, Math.min(PAGE_ROWS, maxRows - have));
    const ended = (/** @type {"cancelled" | "timedOut"} */ flag) =>
      /** @type {DbError} */ (endedBy(/** @type {never} */ ({ [flag]: true }), timeoutMs));
    const backstop =
      timeoutMs > 0 ? setTimer(() => stall(job), timeoutMs + BACKSTOP_MS) : undefined;
    job.running = true;
    try {
      /** @type {Page} */
      let page = heard(
        job,
        await call("db.run", { sessionId, sql: statement.text, pageRows: rowsOf(0) }),
      );
      const columns = page.columns;
      const rows = [...page.rows];
      while (page.more && !page.copy && rows.length < maxRows && !job.cancelled) {
        page = heard(job, await call("db.fetch", { sessionId, pageRows: rowsOf(rows.length) }));
        for (const row of page.rows) rows.push(row);
      }
      // COPY ... FROM STDIN is refused before it is sent (sql/classify.js); one that comes anyway
      // is ended, so the session is not left waiting for data.
      if (page.copy?.direction === "in")
        page = heard(
          job,
          await call("db.copy", { sessionId, fail: "COPY FROM STDIN does not run here" }),
        );
      if (page.more)
        heard(job, await call("db.fetch", { sessionId, close: true }).catch(() => undefined));
      const sets = columns ? [setOf(columns, rows, maxRows, page.more)] : [];
      const base = { index, ran: true, sets, warnings: 0, notices };
      const failure = page.error;
      if (!failure) return { ...base, affected: columns ? null : affectedOf(page) };
      const stopped = failure.code === CANCELED;
      const timeout = /statement timeout/u.test(failure.message) && timeoutMs > 0;
      const error =
        stopped && job.cancelled
          ? ended("cancelled")
          : job.timedOut || (stopped && timeout)
            ? ended("timedOut")
            : errorOf(failure, statement.text);
      return { ...base, affected: null, error };
    } catch (failure) {
      failed(job, failure);
      const error = job.cancelled
        ? ended("cancelled")
        : job.timedOut
          ? ended("timedOut")
          : /** @type {DbError} */ ({
              kind: "client",
              message: `The session ended: ${textOf(failure)}`,
            });
      return { index, ran: true, sets: [], affected: null, warnings: 0, notices, error };
    } finally {
      job.running = false;
      clearTimer(backstop);
    }
  };

  /** A statement of the plugin's own (BEGIN, COMMIT, a savepoint); its error, if any. */
  const own = async (/** @type {Job} */ job, /** @type {string} */ sql) => {
    try {
      const page = heard(job, await call("db.run", { sessionId: job.sessionId, sql }));
      return page?.error ? errorOf(page.error, sql) : undefined;
    } catch (failure) {
      failed(job, failure);
      return /** @type {DbError} */ ({ kind: "client", message: `${sql}: ${textOf(failure)}` });
    }
  };

  /**
   * The plan's statements on the job's session, in its mode, the session's transaction `before`.
   * @param {Job} job @param {Plan} plan @param {Transaction} [before]
   * @returns {Promise<RunResult>}
   */
  const script = async (job, plan, before = "idle") => {
    const outcomes = plan.statements.map((_, index) => notRun(index));
    /** @type {string[]} */
    const notices = [];
    const result = (/** @type {DbError | undefined} */ error) => ({
      statements: outcomes,
      notices,
      ms: 0,
      ...(error ? { error } : {}),
    });
    const wrapped = plan.mode !== "run";
    if (wrapped && before === "failed")
      return result({ kind: "sql", code: "25P02", message: ROLLBACK_FIRST });
    const nested = wrapped && before === "open";
    const sql = nested ? NESTED : PLAIN;
    if (wrapped) {
      const begun = await own(job, sql.begin);
      if (begun) return result(begun);
    }
    let failed = false;
    for (const [index, statement] of plan.statements.entries()) {
      if (job.cancelled) break;
      const outcome = await one(job, statement, index, plan);
      outcomes[index] = outcome;
      failed = Boolean(outcome.error);
      if (failed) break;
    }
    /** @type {DbError | undefined} */
    let error;
    const back =
      plan.mode === "dry-run" || (plan.mode === "transaction" && (failed || job.cancelled));
    if (back) for (const step of sql.rollback) await own(job, step);
    else if (wrapped) for (const step of sql.commit) error ??= await own(job, step);
    if (nested)
      notices.push(
        back
          ? "Rolled back to a savepoint: the console's open transaction stays open."
          : "Ran under a savepoint inside the console's open transaction: COMMIT or ROLLBACK ends it.",
      );
    if (job.cancelled && !outcomes.some((o) => o.error?.kind === "cancelled"))
      notices.push("Cancelled: the statements shown had finished before the cancel reached them.");
    return result(error);
  };

  return { script };
}
