// What a run shows: a tab per result set, and a Messages tab with a line per statement (rows, rows
// affected, the error with its code and detail, not run), the notices, and a summary. The tab that
// opens is the error's, else the first result's. Pure, so the tests read it without a DOM.

import { oneLine } from "./execute.js";

/**
 * @typedef {import("./execute.js").Execution} Execution
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./engines/common.js").DbError} DbError
 * @typedef {{ level: "ok" | "error" | "notice" | "skipped", text: string, statement: number }} Line
 * @typedef {{ label: string, kind: "rows" | "messages", set?: ResultSet, statement: number, lines?: Line[] }} Tab
 * @typedef {{ tabs: Tab[], open: number, summary: string, error?: { statement: number, offset: number } }} Shown
 *   `error.offset` is where the first error is in the editor's text, when the client said.
 */

/**
 * @param {Execution} execution
 * @param {number} [base] Where the run's text starts in the editor, for the error's offset.
 * @returns {Shown}
 */
export function show(execution, base = 0) {
  const { statements, classes, result } = execution;
  /** @type {Tab[]} */
  const tabs = [];
  /** @type {Line[]} */
  const lines = [];
  /** @type {Shown["error"]} */
  let error;
  if (result.error) lines.push({ level: "error", text: errorText(result.error), statement: -1 });
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
  const summary = `${failed ? "Failed" : "Done"}: ${ran} of ${statements.length} statement${statements.length === 1 ? "" : "s"} ran in ${result.ms} ms${tail}`;
  tabs.push({ label: "Messages", kind: "messages", statement: -1, lines });
  const open = failed || !tabs.some((t) => t.kind === "rows") ? tabs.length - 1 : 0;
  return { tabs, open, summary, ...(error ? { error } : {}) };
}

/** How a statement that ran ended: its rows, or the rows it changed. */
function done(/** @type {import("./engines/common.js").StatementOutcome} */ outcome) {
  const sets = outcome.sets;
  const warnings = outcome.warnings
    ? `, ${outcome.warnings} warning${outcome.warnings === 1 ? "" : "s"}`
    : "";
  if (sets.length) {
    const rows = sets.reduce((sum, set) => sum + set.rows.length, 0);
    const more = sets.some((set) => set.truncated) ? "+ (more not loaded)" : "";
    return `${rows}${more} row${rows === 1 && !more ? "" : "s"}${warnings}`;
  }
  if (outcome.affected === null) return `done${warnings}`;
  return `${outcome.affected} row${outcome.affected === 1 ? "" : "s"} affected${warnings}`;
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
