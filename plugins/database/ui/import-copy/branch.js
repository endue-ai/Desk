// The import wizard on a PostgreSQL connection (PG-60), for importer.js: the file read from its
// sample with the COPY options, the new table's columns inferred from it, the statements and the
// problem that holds Import back, the server's check of the first rows, and the run with its
// progress and Cancel, said in one sentence at the end. No DOM.

import { tableName } from "../catalog.js";
import { formatCount } from "../format.js";
import { tableOf } from "./sample.js";
import { copyModel, copyState, copyStatements, inferInto, targetColumns } from "./wizard.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./wizard.js").CopyState} CopyState
 * @typedef {import("./wizard.js").CopyFormat} CopyFormat
 * @typedef {{
 *   path: string, file: string, format: CopyFormat, header: boolean, head: import("./start.js").Head,
 *   copy: CopyState | null, keys: string[], data: { columns: string[], rows: (string | null)[][] },
 *   unreadable: string, problem: string, mapping: (string | null)[], schema: string, table: string,
 *   running: boolean, server: { columns: string[], rows: (string | null)[][] } | { error: string } | null,
 *   checking: boolean, progress: import("./source.js").Progress | null, abort: AbortController | null,
 * }} Held
 *   What importer.js keeps that the COPY part reads and writes.
 */

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
const rowsText = (/** @type {number} */ n) => `${formatCount(n)} row${n === 1 ? "" : "s"}`;

/** @param {ReturnType<typeof import("./start.js").createCopyStarts>} starts */
export function createCopyBranch(starts) {
  /** The target's columns and the qualified table, for `conn`. */
  const target = (/** @type {Held} */ s, /** @type {Connection} */ conn) => {
    const state = /** @type {CopyState} */ (s.copy);
    const name = state.target === "new" ? state.newTable.trim() : s.table;
    return {
      columns: targetColumns(state, s.mapping),
      table: name ? tableName(conn, s.schema, name) : "",
      name,
    };
  };
  const targetOf = (/** @type {Held} */ s, /** @type {Connection} */ conn) => {
    const { columns, table } = target(s, conn);
    const state = /** @type {CopyState} */ (s.copy);
    return { conn, path: s.path, state, header: s.header, keys: s.keys, table, columns };
  };

  return {
    /** Read the sample again with the options; the new table's columns follow it. */
    async reparse(/** @type {Held} */ s) {
      s.copy ??= copyState(s.format, s.file);
      s.server = null;
      try {
        const sample = await starts.sample(s.copy, s.header, s.head);
        s.keys = sample.keys;
        s.data = tableOf(sample, { format: s.format, header: s.header, skip: s.copy.options.skip });
        inferInto(s.copy, s.data);
        s.unreadable = "";
      } catch (error) {
        s.data = { columns: [], rows: [] };
        s.unreadable = messageOf(error);
      }
    },

    /** What the view draws of the COPY, the SQL shown, and the problem that holds Import back. */
    plan(/** @type {Held} */ s, /** @type {Connection} */ conn) {
      const state = /** @type {CopyState} */ (s.copy);
      const { columns, table, name } = target(s, conn);
      let problem = s.unreadable || s.problem;
      if (!problem && !name)
        problem = state.target === "new" ? "Name the new table." : "Pick the table to import into.";
      else if (!problem && s.data.rows.length === 0) problem = "The file holds no rows.";
      const planned = problem ? { problem } : copyStatements(state, table, columns);
      const sql =
        "problem" in planned ? "" : [planned.create, planned.copy].filter(Boolean).join(";\n");
      return {
        copy: copyModel(state, {
          size: s.head.size,
          progress: s.progress,
          server: s.server,
          checking: s.checking,
        }),
        problem: problem || ("problem" in planned ? (planned.problem ?? "") : ""),
        sql,
        columns,
      };
    },

    /** Copy the first rows into a temporary table and read them back, in a rolled-back transaction. */
    async check(/** @type {Held} */ s, /** @type {Connection} */ conn) {
      s.checking = true;
      try {
        s.server = await starts.check(targetOf(s, conn));
      } finally {
        s.checking = false;
      }
    },

    /**
     * Import the file; answers the sentence to say (undefined: nothing ran).
     * @param {Held} s
     * @param {Connection} conn
     * @param {() => void} publish
     */
    async run(s, conn, publish) {
      const abort = new AbortController();
      s.abort = abort;
      s.progress = { rows: 0, bytes: 0, total: s.head.size };
      const { name } = target(s, conn);
      try {
        const done = await starts.run({
          ...targetOf(s, conn),
          signal: abort.signal,
          progress: (p) => {
            s.progress = p;
            publish();
          },
        });
        if (!done) return undefined;
        const state = /** @type {CopyState} */ (s.copy);
        const refused = done.rejected
          ? `; ${rowsText(done.rejected)} refused went to the reject file`
          : "";
        if (done.ok) {
          const how =
            state.batch > 0 ? `in ${formatCount(done.batches)} batches` : "in one transaction";
          return {
            ok: true,
            message: `Imported ${rowsText(done.rows)} into ${name} by COPY ${how}${refused}.`,
          };
        }
        const said = abort.signal.aborted ? "Cancelled" : done.message;
        const kept =
          done.rows > 0
            ? `the first ${rowsText(done.rows)} stay, committed in ${formatCount(done.batches)} batches`
            : "nothing was imported";
        return { ok: false, message: `Rolled back, ${kept}: ${said}` };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      } finally {
        s.abort = null;
        s.progress = null;
      }
    },
  };
}
