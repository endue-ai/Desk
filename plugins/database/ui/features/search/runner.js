// Running a search: the first run (the version, a regular expression tried once), then the tables one
// after another, each in a run of its own through deps.execute (the plugin's own reading: nothing
// to ask, never a password prompt mid-search), with its statement timeout on the server and the
// client's as a backstop a few seconds later (SQLite has only the client's). Cancel aborts the run
// in flight and reads no further table. What the client printed is read in the result worker, as
// every run's is; here only a table's few rows are folded. No DOM.

import { tableName } from "../../catalog.js";
import { searchedColumns } from "./columns.js";
import { fold } from "./model.js";
import { aboutRows } from "./plan.js";
import { keyOf, preflight, scanOf, selectOf, serverOf, tableRun, whyOf } from "./sql.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../engines/common.js").DbError} DbError
 * @typedef {import("./model.js").Run} Run
 * @typedef {import("./model.js").Options} Options
 * @typedef {import("./plan.js").Candidate} Candidate
 * @typedef {import("./plan.js").Estimate} Estimate
 * @typedef {{
 *   execute: import("../../catalog.js").Execute,
 *   columns(conn: Connection, schema: string, table: string, quiet?: boolean): Promise<import("../../catalog.js").Column[]>,
 *   now?(): number,
 *   setTimer?(fn: () => void, ms: number): unknown,
 *   clearTimer?(timer: unknown): void,
 * }} Deps
 */

/** How long past its own timeout the client waits for the server's, before it stops the run. */
const BACKSTOP_MS = 5000;

const words = (/** @type {DbError} */ e) => (e.detail ? `${e.message} ${e.detail}` : e.message);

/** A new run of these tables; those past the size limit are skipped from the start. @returns {Run} */
export function newRun(
  /** @type {Estimate} */ estimate,
  /** @type {Options} */ options,
  /** @type {number} */ now,
) {
  return {
    phase: "running",
    options,
    total: estimate.search.length + estimate.over.length,
    done: estimate.over.length,
    current: "",
    tables: [],
    skipped: estimate.over.map((c) => ({
      schema: c.schema,
      name: c.name,
      why: /** @type {const} */ ("size"),
      detail: c.rows === null ? "" : `about ${aboutRows(c.rows)} rows`,
    })),
    empty: 0,
    kept: 0,
    capped: false,
    error: "",
    started: now,
    ms: 0,
  };
}

/** @param {Deps} deps */
export function createRunner(deps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((t) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (t)));

  /**
   * Search the estimate's tables; `progress` hears the run after each step (a new object each time).
   * @param {Connection} conn
   * @param {Estimate} estimate
   * @param {Options} options
   * @param {{ signal: AbortSignal, progress(run: Run): void }} control
   * @returns {Promise<Run>}
   */
  const run = async (conn, estimate, options, control) => {
    const engine = conn.engine;
    const how = { value: options.value, match: options.match, ignoreCase: options.ignoreCase };
    let state = newRun(estimate, options, now());
    const tell = (/** @type {Partial<Run>} */ patch = {}) => {
      state = { ...state, ...patch, ms: now() - state.started };
      control.progress(state);
      return state;
    };
    const end = (/** @type {Run["phase"]} */ phase, error = "") =>
      tell({ phase, error, current: "" });

    tell();
    const first = await deps.execute(conn, preflight(engine, how).join(";\n"), {
      catalog: true,
      maxRows: 5,
      signal: control.signal,
    });
    if (control.signal.aborted) return end("cancelled");
    const failed = first.result.error ?? first.result.statements.find((s) => s.error)?.error;
    if (failed) {
      const regex = how.match === "regex" && first.result.statements[1]?.error === failed;
      return end(
        failed.kind === "cancelled" ? "cancelled" : "failed",
        regex ? `not a regular expression the server reads: ${failed.message}` : words(failed),
      );
    }
    const server = serverOf(engine, first.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "");
    const timeoutMs = options.timeoutSeconds * 1000;

    for (const table of estimate.search) {
      if (control.signal.aborted) return end("cancelled");
      tell({ current: `${table.schema}.${table.name}` });
      const skip = (/** @type {import("./model.js").Why} */ why, detail = "") => {
        state.skipped = [...state.skipped, { schema: table.schema, name: table.name, why, detail }];
      };
      /** @type {import("../../catalog.js").Column[]} */
      let all;
      try {
        all = await deps.columns(conn, table.schema, table.name, true);
      } catch (error) {
        skip("failed", error instanceof Error ? error.message : String(error));
        tell({ done: state.done + 1 });
        continue;
      }
      const columns = searchedColumns(engine, all, { ...how, families: options.families });
      if (columns.length === 0) {
        tell({ done: state.done + 1, empty: state.empty + 1 });
        continue;
      }
      const primary = all.filter((c) => c.primary).map((c) => c.name);
      const key = keyOf(engine, primary, table.partitioned);
      const from = tableName(conn, table.schema, table.name);
      const target = { schema: table.schema, name: table.name, from };
      const select = selectOf(engine, target, columns, key, {
        how,
        limit: options.rowLimit,
        server,
      });
      const plan = tableRun(engine, select.sql, { timeoutMs, server });

      // One table's run stops on the person's cancel or past its timeout, whichever comes first.
      const stop = new AbortController();
      let timedOut = false;
      const cancel = () => stop.abort();
      control.signal.addEventListener("abort", cancel, { once: true });
      const backstop = timeoutMs + (engine === "sqlite" ? 0 : BACKSTOP_MS);
      const timer = setTimer(() => {
        timedOut = true;
        stop.abort();
      }, backstop);
      /** @type {import("../../execute.js").Execution} */
      let done;
      try {
        done = await deps.execute(conn, plan.statements.join(";\n"), {
          catalog: true,
          interactive: false,
          maxRows: options.rowLimit + 1,
          signal: stop.signal,
        });
      } finally {
        clearTimer(timer);
        control.signal.removeEventListener("abort", cancel);
      }
      const outcomes = done.result.statements;
      const error = done.result.error ?? outcomes.find((s) => s.error)?.error;
      const searched = outcomes[plan.search];
      const finished = searched?.ran === true && !searched.error;
      if (finished) {
        const scan = scanOf(engine, outcomes[plan.explain]?.sets[0]);
        // A copy: the states told before keep their own list of tables.
        state = { ...state, tables: [...state.tables] };
        const rows = searched.sets[0]?.rows ?? [];
        fold(state, { ...target, scan, key }, columns, select.conditions, rows);
      }
      if (control.signal.aborted) {
        if (!finished) skip("cancelled");
        tell({ done: state.done + 1 });
        return end("cancelled");
      }
      if (!finished) {
        if (timedOut) skip("timeout", `stopped after ${backstop / 1000} s`);
        else if (error?.kind === "cancelled") {
          skip("cancelled");
          tell({ done: state.done + 1 });
          return end("cancelled");
        } else if (
          error &&
          (error.kind === "connect" || error.kind === "auth" || error.kind === "missing")
        )
          return end("failed", words(error));
        else {
          const why = whyOf(error ?? { kind: "sql", message: "No answer." });
          skip(why.why, why.why === "failed" ? words(error ?? why) : "");
        }
      }
      tell({ done: state.done + 1 });
    }
    return end("done");
  };

  return { run };
}
