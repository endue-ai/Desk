// What one ask is about, from the console on screen (PG-90): the statement and the range of the
// console's text a proposal takes (write: the selection or the caret; explain: above the statement
// at the caret; fix: the statement that failed in the last run, found by its text; the plan: above
// the statement the console explained last), the error and the plan, and the result a ticked
// sample is taken from. A proposal's text becomes the console's text through `editOf`. Pure.

import { split, statementAt } from "../../sql/split.js";

/**
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("./payload.js").Task} Task
 * @typedef {{ text: string, start: number, end: number }} Editor
 * @typedef {{
 *   statement: string, from: number, to: number, place: "replace" | "above",
 *   error?: import("../../engines/common.js").DbError,
 *   plan?: import("../../explain/node.js").PlanNode,
 *   sample: import("../../engines/common.js").ResultSet | null,
 * }} Context
 */

/** The first result set of the console's last run, which a ticked sample is cut from. */
const lastSet = (/** @type {Console} */ shown) =>
  shown.execution?.result.statements.flatMap((s) => s.sets).find((s) => s.rows.length) ?? null;

/**
 * @param {Task} task
 * @param {Console} shown
 * @param {Editor} editor
 * @param {import("../../sql/lexer.js").Dialect} dialect
 * @returns {Context}
 */
export function contextOf(task, shown, editor, dialect) {
  const { text, start, end } = editor;
  const sample = lastSet(shown);
  if (task === "write") {
    const selected = text.slice(start, end);
    return {
      statement: selected.trim() ? selected : "",
      from: start,
      to: end,
      place: "replace",
      sample,
    };
  }
  if (task === "explain") {
    if (end > start && text.slice(start, end).trim())
      return { statement: text.slice(start, end), from: start, to: start, place: "above", sample };
    const at = statementAt(split(text, dialect), start, text);
    if (!at) throw new Error("Put the caret in a statement for Eris to explain.");
    return { statement: at.text, from: at.start, to: at.start, place: "above", sample };
  }
  if (task === "fix") {
    const execution = shown.execution;
    const failed = execution?.result.statements.find((s) => s.error);
    if (!execution || !failed?.error) {
      const whole = execution?.result.error;
      throw new Error(
        whole
          ? `The last run failed before a statement ran (${whole.message}): Eris fixes a statement's error.`
          : "This console's last run has no error for Eris to fix.",
      );
    }
    const statement = execution.statements[failed.index]?.text ?? "";
    const from = statement ? text.indexOf(statement) : -1;
    if (from < 0) throw new Error("The statement that failed is no longer in the console.");
    return {
      statement,
      from,
      to: from + statement.length,
      place: "replace",
      error: failed.error,
      sample,
    };
  }
  const kept =
    /** @type {Array<{ sql: string, plan: import("../../explain/node.js").PlanNode }>} */ (
      shown.explained ?? []
    ).at(-1);
  if (!kept)
    throw new Error("Explain a statement first (Database: explain), then ask Eris about its plan.");
  const found = text.indexOf(kept.sql);
  const from = found < 0 ? start : found;
  return { statement: kept.sql, from, to: from, place: "above", plan: kept.plan, sample: null };
}

/** An explanation as `--` comments, a line each of at most 96 characters. */
export function commentOf(/** @type {string} */ explanation) {
  /** @type {string[]} */
  const lines = [];
  for (const paragraph of explanation.trim().split(/\n+/u)) {
    let line = "";
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      if (line && line.length + word.length + 1 > 93) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines.map((line, i) => `-- ${i === 0 ? "Eris: " : ""}${line}\n`).join("");
}

/** A statement that ends with its terminator. */
const ended = (/** @type {string} */ sql) => {
  const t = sql.trim();
  return t.endsWith(";") ? t : `${t};`;
};

/**
 * The text a proposal offers for the console, from the brain's checked answer.
 * @param {Task} task
 * @param {{ statement?: string, explanation?: string, suggestion?: string }} answer
 */
export function offerOf(task, answer) {
  if (task === "write" || task === "fix") return (answer.statement ?? "").trim();
  const comment = commentOf(answer.explanation ?? "");
  const suggestion = answer.suggestion?.trim() ? `${ended(answer.suggestion)}\n` : "";
  return `${comment}${suggestion}`;
}

/**
 * The edit a taken proposal makes: a statement written at a caret stands on lines of its own.
 * @param {Context} ctx @param {string} editorText @param {string} offered
 */
export function editOf(ctx, editorText, offered) {
  if (ctx.place === "above" || ctx.from !== ctx.to)
    return { from: ctx.from, to: ctx.to, text: offered };
  const before = ctx.from > 0 && editorText[ctx.from - 1] !== "\n" ? "\n" : "";
  const after = ctx.from < editorText.length && editorText[ctx.from] !== "\n" ? "\n" : "";
  return { from: ctx.from, to: ctx.to, text: `${before}${offered}${after}` };
}
