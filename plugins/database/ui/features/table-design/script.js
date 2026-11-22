// The table form's script (PG-51, ADR 0324): the one function the form calls as the person types and
// the run calls before it runs, so what is shown is what runs. A new table's CREATE (create.js) or an
// existing one's ALTER (alter.js), each step under its marks, between BEGIN and COMMIT; the
// CONCURRENTLY indexes after COMMIT, each on its own. The problems (checks.js) and what the form will
// not write as asked are said, and Run waits while any is there; a script that can be written is
// still shown and opens in a console (a type the server does not have leaves none). Pure.

import { alterSteps } from "./alter.js";
import { problemsOf } from "./checks.js";
import { createSteps } from "./create.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./read.js").Facts} Facts
 * @typedef {import("./alter-columns.js").Step} Step
 * @typedef {{
 *   inside: Step[], after: Step[], problems: string[], text: string,
 * }} Script
 *   `inside` runs in one transaction, `after` each on its own once it commits; `text` is the
 *   script as shown and as a console gets it.
 */

/** A step as the script holds it: its marks as `-- ` lines, then its statement. */
export const stepText = (/** @type {Step} */ step) =>
  [...step.marks.map((m) => `-- ${m}`), `${step.sql};`].join("\n");

/** The text of the steps that run in one transaction, as one run sends them. */
export const insideText = (/** @type {Step[]} */ steps) => steps.map(stepText).join("\n\n");

/**
 * The script of a form: a new table's when `original` is null.
 * @param {Design | null} original
 * @param {Design} design
 * @param {Facts} facts
 * @returns {Script}
 */
export function scriptOf(original, design, facts) {
  const problems = problemsOf(design, facts);
  let steps = /** @type {Step[]} */ ([]);
  try {
    if (original) {
      const altered = alterSteps(original, design, facts);
      steps = altered.steps;
      problems.push(...altered.held);
    } else steps = createSteps(design, facts);
  } catch (error) {
    // A part the problems already name (an unknown type) cannot be written: say it once.
    if (problems.length === 0)
      problems.push(error instanceof Error ? error.message : String(error));
    steps = [];
  }
  const inside = steps.filter((s) => !s.concurrent);
  const after = steps.filter((s) => s.concurrent);
  const parts = [];
  if (inside.length) parts.push("BEGIN;", insideText(inside), "COMMIT;");
  parts.push(...after.map(stepText));
  return { inside, after, problems, text: parts.length ? `${parts.join("\n\n")}\n` : "" };
}
