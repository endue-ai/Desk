// A connection's startup script (PG-12, pg-options.js) on a session just signed in, before anything
// else runs on it: each statement as the plugin's own, under the run's statement timeout. A statement
// that fails ends the sign-in: the session closes, and the error names the startup script and the
// statement, with the server's code and detail. No DOM.

import { t } from "../strings/index.js";
import { startupStatements } from "./pg-options.js";

/**
 * @typedef {import("./common.js").Connection} Connection
 * @typedef {import("./common.js").DbError} DbError
 * @typedef {import("./common.js").RunResult} RunResult
 * @typedef {import("./pg-script.js").Job} Job
 * @typedef {import("./pg-script.js").Plan} Plan
 */

/**
 * Run the connection's startup script on `sessionId`; the error that ends the sign-in, else none.
 * @param {{ script(job: Job, plan: Plan): Promise<Omit<RunResult, "ms">>, close(sessionId: string): Promise<unknown> }} deps
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {number} timeoutMs
 * @returns {Promise<DbError | undefined>}
 */
export async function runStartup(deps, conn, sessionId, timeoutMs) {
  const statements = startupStatements(conn);
  if (statements.length === 0) return undefined;
  /** @type {Job} */
  const job = { sessionId, running: false, cancelled: false, timedOut: false, agent: false };
  const done = await deps.script(job, { statements, maxRows: 1, timeoutMs, mode: "run" });
  const index = done.statements.findIndex((s) => s.error);
  const failed = index >= 0 ? done.statements[index]?.error : done.error;
  if (!failed && !job.ended) return undefined;
  await deps.close(sessionId).catch(() => {});
  const at = index >= 0 ? `, statement ${index + 1}` : "";
  const why = failed?.message ?? job.ended ?? "";
  return {
    kind: failed?.kind === "timeout" || failed?.kind === "cancelled" ? failed.kind : "connect",
    message: t("engines.pgStartup.sStartupScript", {
      name: String(conn.name),
      at: String(at),
      why: String(why),
    }),
    ...(failed?.code ? { code: failed.code } : {}),
    ...(failed?.detail ? { detail: failed.detail } : {}),
  };
}
