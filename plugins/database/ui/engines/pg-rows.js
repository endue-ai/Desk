import { t } from "../strings/index.js";
// Rows of the cursor a console's read keeps (PG-22, ADR 0352, engines/pg-cursor.js): `count` rows
// from `from`, or every row counted. A fetch runs in the owner's turn as a run does, Cancel stops it
// (it is one of the sessions' jobs), and a session gone is not opened again. No DOM.

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./pg-script.js").Job} Job
 * @typedef {import("./pg-script.js").Plan} Plan
 * @typedef {import("./pg-cursor.js").Ask} Ask
 * @typedef {import("./pg-cursor.js").Got} Got
 */

/**
 * @param {{
 *   jobs: Set<Job>, onBusy(running: number): void,
 *   keeper: ReturnType<typeof import("../session/keeper.js").createKeeper>,
 *   cursors: ReturnType<typeof import("./pg-cursor.js").createCursors>,
 * }} deps
 */
export function cursorRows({ jobs, onBusy, keeper, cursors }) {
  const gone = /** @type {const} */ ({
    kind: "client",
    message: t("engines.pgRows.theConsoleSSessionEndedThe"),
  });
  /**
   * @param {Connection} conn @param {import("../session/keeper.js").Owner} owner
   * @param {Ask} ask @param {number} timeoutMs @returns {Promise<Got>}
   */
  return async (conn, owner, ask, timeoutMs) => {
    /** @type {Job} */
    const job = {
      running: false,
      cancelled: false,
      timedOut: false,
      agent: false,
      owner: owner.owner,
    };
    jobs.add(job);
    onBusy(jobs.size);
    try {
      const used = await keeper.use(
        owner,
        conn,
        timeoutMs,
        async () => ({ error: gone }),
        async (entry) => {
          job.sessionId = entry.sessionId;
          job.transaction = entry.transaction;
          /** @type {Plan} */
          const plan = {
            statements: [],
            maxRows: 1,
            timeoutMs: entry.timeoutMs,
            mode: "run",
            session: owner,
          };
          const got = await cursors.rows(job, plan, entry, ask);
          entry.transaction = job.transaction ?? entry.transaction;
          if (job.ended) keeper.lost(entry.sessionId, job.ended);
          return got;
        },
      );
      return "error" in used ? { error: used.error } : used.done;
    } finally {
      jobs.delete(job);
      onBusy(jobs.size);
    }
  };
}
