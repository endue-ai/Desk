// A run's statements on one PostgreSQL session (db.run, ADR 0281), consecutive ones in db.script
// batches (ADR 0344): each statement's pages up to the row limit (the rest closed), its error and
// notices, the statement timeout's backstop (cancel, then close), and the run's mode: BEGIN and COMMIT or ROLLBACK around the script, or, on a console's
// session already in a transaction (PG-02, ADR 0320), a savepoint, so neither ends the person's
// transaction; inside a failed transaction those modes are refused. Each page's ReadyForQuery state
// goes to the job, and a session the run found gone is noted on it. A statement's notices are the
// ones its pages carry (ADR 0334), whatever order events arrive in; the plugin's own statements'
// notices and the session's own (db.notice events, which pg-session.js gathers in `sinks`) are the
// run's. No DOM.

import { ROLLBACK_FIRST } from "../session/words.js";
import { endedBy, notRun } from "./common.js";
import { affectedOf, CANCELED, errorOf, pageNotices, setOf } from "./pg-result.js";

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
 *   quiet?: boolean, background?: boolean,
 * }} Plan
 *   `session` runs on that owner's kept session (a console's, a table view's); `agent` is an
 *   agent's run, which the console's Cancel leaves alone; `signal` cancels this run alone: its
 *   statement on its session, nothing after it (a kept session stays open); `quiet` asks for no
 *   key passphrase (ADR 0331); `background` is work the plugin starts on its own, which a
 *   disconnected connection refuses (session/gate.js, ADR 0339).
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
/** The most statements, and SQL bytes, one db.script call carries (ADR 0344). */
export const BATCH = 200;
const BATCH_BYTES = 1024 * 1024;
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
  /** A page's state, whether its error ends the session (the server's FATAL), and its notices
   * into `notices`. */
  const heard = (
    /** @type {Job} */ job,
    /** @type {Page | undefined} */ page,
    /** @type {string[]} */ notices,
  ) => {
    if (page?.transaction) job.transaction = page.transaction;
    if (page?.error?.severity === "FATAL") job.ended = page.error.message;
    notices.push(...pageNotices(page));
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

  /** The first page `maxRows` asks for, after `have` rows. */
  const rowsOf = (/** @type {number} */ maxRows, /** @type {number} */ have) =>
    Math.max(1, Math.min(PAGE_ROWS, maxRows - have));
  const ended = (/** @type {"cancelled" | "timedOut"} */ flag, /** @type {number} */ timeoutMs) =>
    /** @type {DbError} */ (endedBy(/** @type {never} */ ({ [flag]: true }), timeoutMs));

  /** `work` as the job's running call, under the statement timeout's backstop for `count`
   * statements. @template T @param {Job} job @param {Plan} plan @param {number} count
   * @param {() => Promise<T>} work @returns {Promise<T>} */
  const running = async (job, plan, count, work) => {
    const { timeoutMs } = plan;
    const backstop =
      timeoutMs > 0 ? setTimer(() => stall(job), timeoutMs * count + BACKSTOP_MS) : undefined;
    job.running = true;
    try {
      return await work();
    } finally {
      job.running = false;
      clearTimer(backstop);
    }
  };

  /** The outcome of a statement whose call failed. @returns {StatementOutcome} */
  const caught = (
    /** @type {Job} */ job,
    /** @type {number} */ index,
    /** @type {unknown} */ failure,
    /** @type {string[]} */ notices,
    /** @type {number} */ timeoutMs,
  ) => {
    failed(job, failure);
    const error = job.cancelled
      ? ended("cancelled", timeoutMs)
      : job.timedOut
        ? ended("timedOut", timeoutMs)
        : /** @type {DbError} */ ({
            kind: "client",
            message: `The session ended: ${textOf(failure)}`,
          });
    return { index, ran: true, sets: [], affected: null, warnings: 0, notices, error };
  };

  /**
   * A statement's outcome from its first page: its pages up to `maxRows`, then the rest closed.
   * @param {Job} job @param {Statement} statement @param {number} index @param {Plan} plan
   * @param {Page} first @param {string[]} notices
   * @returns {Promise<StatementOutcome>}
   */
  const finish = async (job, statement, index, plan, first, notices) => {
    const { maxRows, timeoutMs } = plan;
    const sessionId = job.sessionId;
    let page = heard(job, first, notices) ?? first;
    const columns = page.columns;
    const rows = [...page.rows];
    while (page.more && !page.copy && rows.length < maxRows && !job.cancelled) {
      const next = await call("db.fetch", { sessionId, pageRows: rowsOf(maxRows, rows.length) });
      page = heard(job, next, notices);
      for (const row of page.rows) rows.push(row);
    }
    // COPY ... FROM STDIN is refused before it is sent (sql/classify.js); one that comes anyway
    // is ended, so the session is not left waiting for data.
    if (page.copy?.direction === "in")
      page = heard(
        job,
        await call("db.copy", { sessionId, fail: "COPY FROM STDIN does not run here" }),
        notices,
      );
    if (page.more)
      heard(
        job,
        await call("db.fetch", { sessionId, close: true }).catch(() => undefined),
        notices,
      );
    const sets = columns ? [setOf(columns, rows, maxRows, page.more)] : [];
    const base = { index, ran: true, sets, warnings: 0, notices };
    const failure = page.error;
    if (!failure) return { ...base, affected: columns ? null : affectedOf(page) };
    const stopped = failure.code === CANCELED;
    const timeout = /statement timeout/u.test(failure.message) && timeoutMs > 0;
    const error =
      stopped && job.cancelled
        ? ended("cancelled", timeoutMs)
        : job.timedOut || (stopped && timeout)
          ? ended("timedOut", timeoutMs)
          : errorOf(failure, statement.text);
    return { ...base, affected: null, error };
  };

  /** One statement on the job's session (db.run). @param {Job} job @param {Statement} statement
   * @param {number} index @param {Plan} plan @returns {Promise<StatementOutcome>} */
  const one = (job, statement, index, plan) =>
    running(job, plan, 1, async () => {
      /** @type {string[]} */
      const notices = [];
      try {
        const pageRows = rowsOf(plan.maxRows, 0);
        const first = await call("db.run", {
          sessionId: job.sessionId,
          sql: statement.text,
          pageRows,
        });
        return await finish(job, statement, index, plan, first, notices);
      } catch (failure) {
        return caught(job, index, failure, notices, plan.timeoutMs);
      }
    });

  /**
   * Statements from `start` in one db.script call (ADR 0344): the outcome of each that ran, a
   * statement whose page has rows left read on first; a failure is the next statement's outcome.
   * @param {Job} job @param {Statement[]} group @param {number} start @param {Plan} plan
   * @returns {Promise<StatementOutcome[]>}
   */
  const many = (job, group, start, plan) =>
    running(job, plan, group.length, async () => {
      /** @type {StatementOutcome[]} */
      const done = [];
      const statements = group.map((statement) => ({ sql: statement.text }));
      const params = { sessionId: job.sessionId, statements, pageRows: rowsOf(plan.maxRows, 0) };
      /** @type {import("@endue-ai/bridge").DbScriptResult} */
      let answer;
      try {
        answer = await call("db.script", params);
      } catch (failure) {
        return [caught(job, start, failure, [], plan.timeoutMs)];
      }
      for (const [at, page] of answer.pages.entries()) {
        /** @type {string[]} */
        const notices = [];
        const statement = /** @type {Statement} */ (group[at]);
        try {
          done.push(await finish(job, statement, start + at, plan, page, notices));
        } catch (failure) {
          done.push(caught(job, start + at, failure, notices, plan.timeoutMs));
          return done;
        }
      }
      const next = start + done.length;
      const failure = answer.failure;
      if (failure)
        done.push(
          caught(job, next, Object.assign(new Error(failure.message), failure), [], plan.timeoutMs),
        );
      // The backstop's cancel stopped it between statements: the next one is the one it stopped.
      else if (
        answer.cancelled &&
        job.timedOut &&
        !job.cancelled &&
        done.length < group.length &&
        !done.at(-1)?.error
      )
        done.push({ ...notRun(next), ran: true, error: ended("timedOut", plan.timeoutMs) });
      return done;
    });

  /** A statement of the plugin's own (BEGIN, COMMIT, a savepoint); its error, if any. Its notices
   * (a deferred trigger's at COMMIT) go in `notices`, the run's. */
  const own = async (
    /** @type {Job} */ job,
    /** @type {string} */ sql,
    /** @type {string[]} */ notices,
  ) => {
    try {
      const page = heard(job, await call("db.run", { sessionId: job.sessionId, sql }), notices);
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
    const sessionId = /** @type {string} */ (job.sessionId);
    // The session's own notices heard since its last run, and those that come while this one runs.
    const notices = sinks.get(sessionId) ?? [];
    sinks.set(sessionId, notices);
    try {
      return await steps(job, plan, before, notices);
    } finally {
      if (sinks.get(sessionId) === notices) sinks.set(sessionId, []);
    }
  };

  /**
   * @param {Job} job @param {Plan} plan @param {Transaction} before @param {string[]} notices
   * @returns {Promise<RunResult>}
   */
  const steps = async (job, plan, before, notices) => {
    const outcomes = plan.statements.map((_, index) => notRun(index));
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
      const begun = await own(job, sql.begin, notices);
      if (begun) return result(begun);
    }
    let failed = false;
    for (let at = 0; at < plan.statements.length && !job.cancelled && !failed; ) {
      const group = groupFrom(plan.statements, at);
      const done =
        group.length === 1
          ? [await one(job, /** @type {Statement} */ (group[0]), at, plan)]
          : await many(job, group, at, plan);
      for (const outcome of done) outcomes[outcome.index] = outcome;
      failed = done.length === 0 || done.some((outcome) => outcome.error);
      at += done.length;
    }
    /** @type {DbError | undefined} */
    let error;
    const back =
      plan.mode === "dry-run" || (plan.mode === "transaction" && (failed || job.cancelled));
    if (back) for (const step of sql.rollback) await own(job, step, notices);
    else if (wrapped) for (const step of sql.commit) error ??= await own(job, step, notices);
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

/** The statements from `at` one call carries: BATCH at most, and BATCH_BYTES of SQL unless one
 * alone is larger. @param {Statement[]} statements @param {number} at */
function groupFrom(statements, at) {
  let bytes = 0;
  let end = at;
  while (end < statements.length && end - at < BATCH) {
    bytes += /** @type {Statement} */ (statements[end]).text.length;
    if (end > at && bytes > BATCH_BYTES) break;
    end += 1;
  }
  return statements.slice(at, end);
}
