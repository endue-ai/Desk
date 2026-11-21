// A maintenance form's run: refused on a read-only connection, a standby, a server older than 13
// or a statement that cannot run yet; the statistics read before; the statement sent alone in run
// mode through deps.execute, so it is a db.run of its own on the session and the server runs it
// outside a transaction block (the executor's guards ask on production and for an agent); its progress read
// from the server's views while it goes on, one read at a time; its cancel by pg_cancel_backend of
// its session; and the statistics read again when it ends. No DOM.

import { formatDuration } from "../../format.js";
import { split } from "../../sql/split.js";
import { labelOf } from "./model.js";
import { TITLES } from "./options.js";
import { wordsOf } from "./read.js";
import { statementOf, tooOld } from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./controller.js").MaintenanceState} MaintenanceState
 * @typedef {import("./controller.js").Run} Run
 * @typedef {import("./model.js").Read} Read
 * @typedef {{
 *   deps: Pick<import("../../feature-host.js").Deps, "execute" | "say">,
 *   reader: ReturnType<typeof import("./read.js").createReader>,
 *   stateOf(id: string): MaintenanceState | undefined,
 *   update(id: string, patch: Partial<MaintenanceState>): void,
 *   connOf(id: string): { conn: Connection, state: MaintenanceState },
 * }} Inner
 */

const OUTPUT_LINES = 200;
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const cancelledBy = (/** @type {import("../../engines/common.js").DbError} */ e) =>
  e.kind === "cancelled" || /canceling statement due to user request/u.test(e.message);

/** Why a form's run does not start, or "". */
export function refusalOf(
  /** @type {Pick<Connection, "name" | "readOnly">} */ conn,
  /** @type {MaintenanceState} */ s,
) {
  if (conn.readOnly)
    return `${conn.name} is read-only: VACUUM, ANALYZE, REINDEX and CLUSTER do not run on it.`;
  if (!s.read) return s.error || "The target is not read yet.";
  const old = tooOld(conn.name, s.read.version, s.read.server);
  if (old) return old;
  if (s.read.recovery)
    return `${conn.name} is a standby (in recovery): maintenance runs on the primary.`;
  return statementOf(s, s.read).problem;
}

/** @param {Inner} inner */
export function createRuns({ deps, reader, stateOf, update, connOf }) {
  /** @type {Set<string>} */
  const polling = new Set();
  const setRun = (/** @type {string} */ id, /** @type {Partial<Run> | null} */ patch) => {
    const now = stateOf(id);
    if (now)
      update(id, {
        run: patch && now.run ? { ...now.run, ...patch } : /** @type {Run | null} */ (patch),
      });
  };

  /** Run a form's statement alone (outside a transaction block) and read the statistics after. */
  const run = async (/** @type {string} */ id, { agent = false } = {}) => {
    const { conn, state } = connOf(id);
    if (state.run?.status === "running") throw new Error("This form's run is still going on.");
    const refused = refusalOf(conn, state);
    if (refused) throw new Error(refused);
    const read = /** @type {Read} */ (state.read);
    const { sql } = statementOf(state, read);
    const statements = split(sql, "postgresql");
    if (statements.length !== 1) throw new Error("The form's statement is not one statement.");
    const before = await reader.stats(conn, state.target).catch(() => read.stats);
    const started = Date.now();
    /** @type {Run} */
    const begun = {
      status: "running",
      sql,
      started,
      reads: 0,
      progress: null,
      output: [],
      error: "",
      ms: 0,
      before,
      after: null,
      cancelling: false,
      note: "",
    };
    update(id, { run: begun });
    let done;
    try {
      done = await deps.execute(conn, sql, {
        statements,
        mode: "run",
        maxRows: 100,
        ...(agent ? { agent: true, interactive: false } : {}),
      });
    } catch (error) {
      setRun(id, null);
      throw error;
    }
    const { result } = done;
    const outcome = result.statements[0];
    const failure = result.error ?? outcome?.error;
    const output = [...(outcome?.notices ?? []), ...result.notices].slice(0, OUTPUT_LINES);
    const status = !failure ? "done" : cancelledBy(failure) ? "cancelled" : "failed";
    let after = null;
    let note = "";
    try {
      after = await reader.stats(conn, state.target);
      // The form's facts line shows the target as it is now.
      const now = stateOf(id)?.read;
      if (now) update(id, { read: { ...now, stats: after } });
    } catch (error) {
      note = `The statistics were not read again: ${words(error)}`;
    }
    const ms = result.ms || Date.now() - started;
    const error = failure ? wordsOf(failure) : "";
    setRun(id, { status, output, error, ms, after, cancelling: false, note });
    const what = `${TITLES[state.operation]} of ${labelOf(state.target, read.database)}`;
    deps.say(
      status === "done"
        ? `${what} done in ${formatDuration(ms)}.`
        : status === "cancelled"
          ? `${what} cancelled.`
          : `${what} failed: ${error}`,
    );
    return { statement: sql, status, ...(error ? { error } : {}), ms, output, before, after };
  };

  /** Read where a form's run is; one read at a time, counted so the panel reads again after it. */
  const progress = async (/** @type {string} */ id) => {
    const { conn, state } = connOf(id);
    const begun = state.run;
    if (begun?.status !== "running" || polling.has(id)) return null;
    polling.add(id);
    let seen = null;
    let note = "";
    try {
      seen = await reader.progress(conn, begun.sql);
    } catch (error) {
      note = `Progress not read: ${words(error)}`;
    } finally {
      polling.delete(id);
    }
    const now = stateOf(id)?.run;
    if (now?.status !== "running" || now.started !== begun.started) return null;
    setRun(id, { progress: seen ?? now.progress, reads: now.reads + 1, note });
    return seen;
  };

  /** Cancel a form's run on the server (pg_cancel_backend of its session). */
  const cancel = async (/** @type {string} */ id) => {
    const { conn, state } = connOf(id);
    const begun = state.run;
    if (begun?.status !== "running") throw new Error("Nothing runs from this form.");
    setRun(id, { cancelling: true });
    const sent = await reader.cancel(conn, begun.sql).catch((error) => {
      setRun(id, { cancelling: false });
      throw error;
    });
    if (sent === 0) {
      if (stateOf(id)?.run?.status === "running") setRun(id, { cancelling: false });
      throw new Error(
        "Not cancelled: the run's session was not found on the server; it may have just ended.",
      );
    }
    deps.say("Cancel sent to the server.");
    return { cancelled: sent };
  };

  return { run, progress, cancel };
}
