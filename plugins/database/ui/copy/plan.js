// Whether a run may hold a COPY through standard input or output, and which (PG-23): it runs alone,
// so its file is chosen for that one COPY; never for an agent, which gets no dialog; and a run given
// a sink or a source must be the COPY that uses it. No DOM.

import { copyOf } from "./statement.js";

/**
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("./statement.js").Direction} Direction
 * @typedef {import("./stream.js").Copy} Copy
 * @typedef {{ statement: Statement, direction: Direction }} Step
 */

/**
 * The run's COPY through standard input or output, undefined for none, or the sentence that
 * refuses the run.
 * @param {import("../sql/lexer.js").Dialect} dialect
 * @param {Statement[]} statements
 * @param {{ agent?: boolean, copy?: Copy }} options
 * @returns {Step | string | undefined}
 */
export function copyStep(dialect, statements, options) {
  const at = dialect === "postgresql" ? statements.findIndex((s) => copyOf(s) !== undefined) : -1;
  const statement = statements[at];
  if (!statement)
    return options.copy
      ? "Nothing to copy: the run holds no COPY ... FROM STDIN or TO STDOUT."
      : undefined;
  const direction = /** @type {Direction} */ (copyOf(statement));
  if (statements.length > 1)
    return `Statement ${at + 1}: a COPY through standard input or output runs on its own, so its file is chosen for it. Run it alone.`;
  if (options.agent)
    return "An agent cannot run a COPY through standard input or output: the person chooses its file. Run it from a console.";
  const fits = direction === "out" ? options.copy?.sink : options.copy?.source;
  if (options.copy && !fits)
    return direction === "out"
      ? "COPY ... TO STDOUT writes its rows: the run has no place to write them."
      : "COPY ... FROM STDIN reads its rows: the run has nothing to read them from.";
  return { statement, direction };
}
