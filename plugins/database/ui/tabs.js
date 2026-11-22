// What a run shows: a tab per result set, and a Messages tab with a line per statement (rows, rows
// affected, the error with its code and detail, not run), the notices, and a summary. The tab that
// opens is the error's, else the first result's. A result set with a column of shapes gets a Map
// tab right after its own (PG-46, geo/detect.js); the console's pinned tabs follow, kept through its
// runs (compare/pins.js, PG-26), and a console that listens gets its Notifications tab last (PG-25,
// session/listen-tabs.js). Pure, so the tests read it without a DOM.

import { oneLine } from "./execute.js";
import { formatCount, formatDuration } from "./format.js";
import { spatialColumns } from "./geo/detect.js";
import { offerOf } from "./session/connect-gate.js";

/**
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./engines/common.js").DbError} DbError
 * @typedef {{ level: "ok" | "error" | "notice" | "skipped", text: string, statement: number, act?: { action: string, args: unknown[], label: string } }} Line
 *   `act`: a press beside the line (Allow connecting to a refused server, ADR 0335).
 * @typedef {{ label: string, kind: "rows" | "messages" | "plan" | "map" | "pinned" | "chart" | "notifications", set?: ResultSet, note?: string, stopped?: boolean, statement: number, lines?: Line[], plan?: import("./explain/plan.js").PlanNode, view?: "tree" | "flame" | "table", geo?: { set: ResultSet, columns: import("./geo/detect.js").Spatial[] }, pin?: import("./compare/pins.js").Pin, chart?: import("./chart/model.js").ChartTab }} Tab
 *   A plan tab (Explain) holds the plan tree read from the rows tab after it, and how it is drawn;
 *   a map tab (`geo`) the set before it and the columns that hold its shapes. A pinned tab holds a
 *   result of an earlier run as it was, `statement` -1: it is no run's. A chart tab (opened on
 *   request, features/chart/) the result it draws and how. A notifications tab (PG-25,
 *   session/listen-tabs.js) is what the console's session heard after LISTEN, as a result, with a
 *   `note` and whether it `stopped` listening.
 * @typedef {{ tabs: Tab[], open: number, summary: string, error?: { statement: number, offset: number } }} Shown
 *   `error.offset` is where the first error is in the editor's text, when the client said.
 */

/**
 * @param {Execution} execution
 * @param {number} [base] Where the run's text starts in the editor, for the error's offset.
 * @param {Tab[]} [pinned] The console's pinned tabs, after the run's.
 * @returns {Shown}
 */
export function show(execution, base = 0, pinned = []) {
  const { statements, classes, result } = execution;
  /** @type {Tab[]} */
  const tabs = [];
  /** @type {Line[]} */
  const lines = [];
  /** @type {Shown["error"]} */
  let error;
  if (result.error)
    lines.push({
      level: "error",
      text: errorText(result.error),
      statement: -1,
      ...offerOf(execution.conn, result.error),
    });
  result.statements.forEach((outcome, index) => {
    const verb = classes[index]?.verb || "Statement";
    const number = statements.length > 1 ? `${index + 1}. ` : "";
    for (const notice of outcome.notices)
      lines.push({ level: "notice", text: notice, statement: index });
    if (!outcome.ran) {
      if (!result.error)
        lines.push({ level: "skipped", text: `${number}${verb}: not run`, statement: index });
      return;
    }
    outcome.sets.forEach((set, n) => {
      const label =
        statements.length > 1 || outcome.sets.length > 1
          ? `${index + 1}${outcome.sets.length > 1 ? `.${n + 1}` : ""}`
          : "Result";
      tabs.push({ label, kind: "rows", set, statement: index });
      const columns = spatialColumns(set);
      if (columns.length)
        tabs.push({
          label: label === "Result" ? "Map" : `Map ${label}`,
          kind: "map",
          statement: index,
          geo: { set, columns },
        });
    });
    if (outcome.error) {
      lines.push({
        level: "error",
        text: `${number}${errorText(outcome.error)}`,
        statement: index,
      });
      if (outcome.error.detail)
        lines.push({ level: "error", text: outcome.error.detail, statement: index });
      const statement = statements[index];
      if (!error && statement)
        error = {
          statement: index,
          offset: base + statement.start + (outcome.error.position ?? 0),
        };
      return;
    }
    lines.push({ level: "ok", text: `${number}${verb}: ${done(outcome)}`, statement: index });
  });
  for (const notice of result.notices) lines.push({ level: "notice", text: notice, statement: -1 });
  const ran = result.statements.filter((s) => s.ran).length;
  const failed = Boolean(result.error) || result.statements.some((s) => s.error);
  const tail =
    execution.mode === "dry-run"
      ? ", rolled back (dry run)"
      : execution.mode === "transaction"
        ? ", in one transaction"
        : "";
  // A run the person cancelled says so, and counts the statements that finished before it.
  const cancelled = [result.error, ...result.statements.map((s) => s.error)].some(
    (e) => e?.kind === "cancelled",
  );
  const finished = result.statements.filter((s) => s.ran && !s.error).length;
  const count = `${formatCount(cancelled ? finished : ran)} of ${formatCount(statements.length)} statement${statements.length === 1 ? "" : "s"}`;
  const summary = cancelled
    ? `Cancelled: ${count} finished in ${formatDuration(result.ms)}${tail}`
    : `${failed ? "Failed" : "Done"}: ${count} ran in ${formatDuration(result.ms)}${tail}`;
  tabs.push({ label: "Messages", kind: "messages", statement: -1, lines });
  const open = failed || !tabs.some((t) => t.kind === "rows") ? tabs.length - 1 : 0;
  tabs.push(...pinned);
  return { tabs, open, summary, ...(error ? { error } : {}) };
}

/** How a statement that ran ended: its rows, or the rows it changed. */
function done(/** @type {import("./engines/common.js").StatementOutcome} */ outcome) {
  const sets = outcome.sets;
  const warnings = outcome.warnings
    ? `, ${formatCount(outcome.warnings)} warning${outcome.warnings === 1 ? "" : "s"}`
    : "";
  if (sets.length) {
    const rows = sets.reduce((sum, set) => sum + set.rows.length, 0);
    // A read its cursor keeps (PG-22): at least the rows the server gave so far.
    const kept = sets.find((set) => set.window && !set.window.done)?.window;
    if (kept) return `at least ${formatCount(kept.known)} rows (more as you scroll)${warnings}`;
    const more = sets.some((set) => set.truncated) ? "+ (more not loaded)" : "";
    return `${formatCount(rows)}${more} row${rows === 1 && !more ? "" : "s"}${warnings}`;
  }
  if (outcome.affected === null) return `done${warnings}`;
  return `${formatCount(outcome.affected)} row${outcome.affected === 1 ? "" : "s"} affected${warnings}`;
}

/** An error as one line: its code, then its message. */
export function errorText(/** @type {DbError} */ error) {
  return error.code ? `Error ${error.code}: ${error.message}` : error.message;
}

/** A history entry's summary of a statement that ran. */
export function summaryOf(/** @type {Execution} */ execution, /** @type {number} */ index) {
  const outcome = execution.result.statements[index];
  if (!outcome?.ran) return "not run";
  if (outcome.error) return oneLine(errorText(outcome.error)).slice(0, 80);
  return done(outcome);
}
