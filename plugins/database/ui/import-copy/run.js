// An import's run on its server (PG-60): on a session of its own (an owner of the plugin's kept
// sessions, closed at the end), BEGIN, the date order (SET LOCAL DateStyle), CREATE TABLE for a new
// table, then `COPY ... FROM STDIN` from the file's rows (source.js) through `copyIn`, so the guards,
// the statement timeout and Cancel hold, then COMMIT. Batches commit every N rows and start again.
// In skip mode the rows go in segments under a savepoint: a row the server refuses (its line, from
// the COPY's context) goes to the reject file with the server's reason, the segment rolls back to
// its savepoint and is sent again without it. Any other failure, and Cancel, roll back. No DOM.

import { copyIn } from "../copy/index.js";
import { t } from "../strings/index.js";
import { replay } from "./source.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../copy/index.js").Execute} Execute
 * @typedef {import("../copy/stream.js").Source} Source
 * @typedef {ReturnType<typeof import("./source.js").createRows>} Rows
 * @typedef {{ write(row: number, reason: string, line: string): void, flush(): Promise<void> }} Rejects
 * @typedef {{
 *   execute: Execute, conn: Connection, owner: import("../session/keeper.js").Owner, signal: AbortSignal,
 *   begin: string[], create?: string, copy: string, rows: Rows, batch: number,
 *   rejects?: Rejects, forget(owner: string): void,
 * }} Run
 *   `begin` runs after each BEGIN (the date order); `batch` is the rows a transaction takes (0: all);
 *   `rejects` is skip mode's file.
 * @typedef {{ ok: boolean, rows: number, rejected: number, batches: number, message: string }} Outcome
 */

/** The rows a segment of skip mode holds to send again. */
export const SEGMENT_ROWS = 10_000;
/** The refused rows past which skip mode stops. */
export const MAX_REJECTS = 1000;
const LINE = /^(?:.*?, )?line (\d+): /iu;

class Stop extends Error {}

/** The failure of a run's first statement, or undefined. */
function failureOf(/** @type {import("../execute.js").Execution} */ run) {
  const error = run.result.error ?? run.result.statements.find((s) => s.error)?.error;
  return error;
}

/**
 * @param {Run} run
 * @returns {Promise<Outcome>}
 */
export async function runCopy(run) {
  const { execute, conn, owner, signal, rows, rejects } = run;
  const on = { session: owner, asked: true, signal };
  let rejected = 0;
  let sent = 0;
  let kept = 0;
  let batches = 0;
  let open = false;
  /** Run one statement of the plugin's own; a failure stops the import with its sentence. */
  const exec = async (/** @type {string} */ sql, /** @type {boolean} */ always = false) => {
    const done = await execute(conn, sql, always ? { session: owner, asked: true } : on);
    const error = failureOf(done);
    if (error) throw new Stop(error.message);
  };
  const begin = async () => {
    await exec("BEGIN");
    open = true;
    for (const sql of run.begin) await exec(sql);
  };
  /** One COPY from `source`; answers the rows it took, or its error. */
  const copy = async (/** @type {Source} */ source) => {
    const done = await copyIn(execute, conn, run.copy, source, on);
    const error = failureOf(done);
    if (error) return { error };
    return { count: done.result.statements[0]?.affected ?? 0 };
  };

  /** Skip mode: one segment under a savepoint, sent again without each row the server refuses. */
  const segment = async (/** @type {number} */ size) => {
    /** @type {{ lines: string[], rows: number[] }} */
    const held = { lines: [], rows: [] };
    const fresh = rows.batch(size, held);
    await exec("SAVEPOINT desk_import");
    let got = await copy(fresh);
    while ("error" in got && got.error) {
      const line = Number(LINE.exec(got.error.message)?.[1] ?? 0);
      if (signal.aborted || got.error.kind === "cancelled" || !line || !held.lines[line - 1])
        throw new Stop(got.error.message);
      await exec("ROLLBACK TO SAVEPOINT desk_import");
      const reason = got.error.message.replace(LINE, "");
      rejects?.write(held.rows[line - 1] ?? 0, reason, held.lines[line - 1] ?? "");
      held.lines.splice(line - 1, 1);
      held.rows.splice(line - 1, 1);
      if (++rejected > MAX_REJECTS)
        throw new Stop(
          t("importCopy.run.moreThanRowsWereRefusedNothing", { MAX_REJECTS: String(MAX_REJECTS) }),
        );
      rows.clear();
      got = await copy(chain(replay([...held.lines]), fresh));
    }
    await exec("RELEASE SAVEPOINT desk_import");
    await rejects?.flush();
    return got.count ?? 0;
  };

  try {
    await begin();
    if (run.create) await exec(run.create);
    let inBatch = 0;
    while (!rows.done()) {
      const room = run.batch > 0 ? run.batch - inBatch : Number.POSITIVE_INFINITY;
      const before = rows.progress().rows;
      let count;
      if (rejects) count = await segment(Math.min(SEGMENT_ROWS, room));
      else {
        const got = await copy(rows.batch(room));
        if ("error" in got && got.error) throw new Stop(got.error.message);
        count = got.count ?? 0;
      }
      // A COPY that read nothing would loop for ever: the server took none of the rows.
      if (rows.progress().rows === before && !rows.done())
        throw new Stop(t("importCopy.run.theServerEndedTheCopyBefore"));
      inBatch += count;
      sent += count;
      if (run.batch > 0 && inBatch >= run.batch && !rows.done()) {
        await exec("COMMIT");
        open = false;
        batches++;
        kept = sent;
        inBatch = 0;
        await begin();
      }
    }
    await exec("COMMIT");
    open = false;
    batches++;
    return { ok: true, rows: sent, rejected, batches, message: "" };
  } catch (failure) {
    if (open) await exec("ROLLBACK", true).catch(() => {});
    const message = failure instanceof Error ? failure.message : String(failure);
    // Only the batches committed before the failure stay.
    return { ok: false, rows: kept, rejected, batches, message };
  } finally {
    run.forget(owner.owner);
  }
}

/**
 * Two sources one after the other.
 * @param {Source} first
 * @param {Source} then
 * @returns {Source}
 */
function chain(first, then) {
  let onFirst = true;
  return {
    async read() {
      if (onFirst) {
        const chunk = await first.read();
        if (chunk) return chunk;
        onFirst = false;
      }
      return then.read();
    },
  };
}
