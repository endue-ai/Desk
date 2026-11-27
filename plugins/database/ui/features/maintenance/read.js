// What the maintenance form reads from the server, each through deps.execute as the plugin's own
// reading (`catalog`: nothing to ask): the target's facts when the form opens or is read again,
// its statistics after a run, the run's progress while it goes on, and the cancel of the run's
// session. A failed read is an error whose words are the sentence to show. No DOM.

import { indexesOf, progressOf, readOf, statsOf } from "./model.js";
import { cancelSql, factsSql, progressSql, statsQueries } from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../engines/common.js").DbError} DbError
 * @typedef {import("./options.js").Target} Target
 */

const ROWS = 10_000;

/** A failure in words: its message, then its DETAIL and HINT lines without their labels. */
export function wordsOf(/** @type {Pick<DbError, "message" | "detail">} */ error) {
  const more = (error.detail ?? "")
    .split("\n")
    .filter((line) => /^(?:DETAIL|HINT):/u.test(line))
    .map((line) => line.replace(/^[A-Z]+:\s*/u, "").trim())
    .join(" ");
  return more ? `${error.message}. ${more}` : error.message;
}

/** @param {{ execute: import("../../catalog.js").Execute }} deps */
export function createReader(deps) {
  /** Each statement's rows; a failure throws its words. `background` is a read of the plugin's
   * own (progress, the statistics after), which a disconnected connection refuses (ADR 0339). */
  const sets = async (
    /** @type {Connection} */ conn,
    /** @type {string[]} */ sqls,
    background = false,
  ) => {
    const options = { catalog: true, maxRows: ROWS, ...(background ? { background: true } : {}) };
    const { result } = await deps.execute(conn, sqls.join(";\n"), options);
    if (result.error) throw new Error(wordsOf(result.error));
    const failed = result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(wordsOf(failed));
    return result.statements.map((s) => s.sets[0]?.rows ?? []);
  };

  return {
    /** The server, the target's size and statistics, its indexes or a schema's tables. */
    facts: async (/** @type {Connection} */ conn, /** @type {Target} */ target) =>
      readOf(target, (await sets(conn, factsSql(target))).slice(1)),
    /** The target's statistics now (after a run: `background`). */
    async stats(/** @type {Connection} */ conn, /** @type {Target} */ target, background = false) {
      const [, row = [], indexes = []] = await sets(conn, statsQueries(target), background);
      return statsOf(row[0] ?? [], indexesOf(indexes), target.kind === "index" ? target.index : "");
    },
    /** Where the run of `sql` is, or null while its session is not found. */
    async progress(/** @type {Connection} */ conn, /** @type {string} */ sql) {
      const [rows = []] = await sets(conn, [progressSql(sql)], true);
      return progressOf(rows);
    },
    /** Cancel the run of `sql` on the server; resolves with how many sessions were signalled. */
    async cancel(/** @type {Connection} */ conn, /** @type {string} */ sql) {
      const [rows = []] = await sets(conn, [cancelSql(sql)]);
      return rows.filter((row) => row[0] === "t").length;
    },
  };
}
