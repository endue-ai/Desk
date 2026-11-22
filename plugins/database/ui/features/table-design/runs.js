// The table form's run (PG-51, ADR 0324): the script the form shows, refused on a read-only
// connection, while a problem stands or when nothing changes; its transaction's steps sent as one
// run in one transaction (or a dry run, rolled back at the end) through deps.execute, so the
// plugin's guards apply (production asked with its tag, DROP asked as dangerous, the schema cache
// reading what changed); then each CONCURRENTLY index on its own, which a dry run leaves out. A
// failure says the server's words and which step stopped it. No DOM.

import { split } from "../../sql/split.js";
import { insideText, scriptOf, stepText } from "./script.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../engines/common.js").DbError} DbError
 * @typedef {import("./controller.js").DesignState} DesignState
 * @typedef {{
 *   status: "running" | "done" | "failed", dry: boolean, message: string, step: number,
 * }} Run
 *   `step` is the index of the step that failed in the script's order (-1: none).
 */

/** The server's words: its message, then its DETAIL and HINT. */
export function wordsOf(/** @type {Pick<DbError, "message" | "detail">} */ error) {
  const more = (error.detail ?? "")
    .split("\n")
    .map((line) => line.replace(/^(?:DETAIL|HINT):\s*/u, "").trim())
    .filter(Boolean)
    .join(" ");
  return more ? `${error.message}. ${more}` : error.message;
}

/** Why the form's script does not run, or "". */
export function refusalOf(/** @type {DesignState} */ s) {
  if (s.conn.readOnly)
    return `${s.conn.name} is read-only: the form shows the script and runs nothing.`;
  if (!s.read || !s.design) return s.error || "The table is not read yet.";
  const script = scriptOf(s.read.original, s.design, s.read.facts);
  if (script.problems.length) return script.problems[0] ?? "";
  if (!script.inside.length && !script.after.length)
    return s.read.original ? "Nothing changes yet: the form is as the table is." : "";
  return "";
}

/**
 * @param {{
 *   execute: import("../../catalog.js").Execute,
 *   stateOf(id: string): DesignState | undefined,
 *   update(id: string, patch: Partial<DesignState>): void,
 *   connOf(id: string): { conn: Connection, state: DesignState },
 * }} inner
 */
export function createRuns({ execute, stateOf, update, connOf }) {
  const setRun = (/** @type {string} */ id, /** @type {Run | null} */ run) => {
    if (stateOf(id)) update(id, { run });
  };

  /**
   * Run (or dry-run) a form's script. Answers what ran and what came of it.
   * @param {string} id
   * @param {{ dry?: boolean }} [how]
   */
  const run = async (id, { dry = false } = {}) => {
    const { conn, state } = connOf(id);
    if (state.run?.status === "running") throw new Error("The form's script is running.");
    const refused = refusalOf(state);
    if (refused) throw new Error(refused);
    const read = /** @type {NonNullable<DesignState["read"]>} */ (state.read);
    const script = scriptOf(
      read.original,
      /** @type {import("./model.js").Design} */ (state.design),
      read.facts,
    );
    setRun(id, { status: "running", dry, message: "", step: -1 });
    /** @type {{ step: number, error: DbError } | null} */
    let failed = null;
    let ran = 0;
    try {
      if (script.inside.length) {
        const sql = insideText(script.inside);
        const statements = split(sql, "postgresql");
        const done = await execute(conn, sql, {
          statements,
          mode: dry ? "dry-run" : "transaction",
        });
        const { result } = done;
        const at = result.statements.findIndex((s) => s.error);
        const error = result.error ?? result.statements[at]?.error;
        if (error) failed = { step: Math.max(at, 0), error };
        else ran += script.inside.length;
      }
      if (!failed && !dry)
        for (const [i, step] of script.after.entries()) {
          const sql = stepText(step);
          const done = await execute(conn, sql, {
            statements: split(sql, "postgresql"),
            mode: "run",
          });
          const error = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
          if (error) {
            failed = { step: script.inside.length + i, error };
            break;
          }
          ran += 1;
        }
    } catch (error) {
      // Asked and not run (a production connection, a dangerous step): the form is as it was.
      setRun(id, null);
      throw error;
    }
    const left =
      dry && script.after.length ? " The CONCURRENTLY indexes are not part of a dry run." : "";
    const said = failed ? wordsOf(failed.error) : "";
    const message = failed
      ? `Step ${failed.step + 1} failed: ${said}${/[.!?]$/u.test(said) ? "" : "."}${
          failed.step >= script.inside.length && script.inside.length
            ? " The transaction before it was committed."
            : script.inside.length && failed.step < script.inside.length
              ? " Nothing was changed: the transaction rolled back."
              : ""
        }`
      : dry
        ? `The dry run went through and rolled back: ${script.inside.length} ${
            script.inside.length === 1 ? "step" : "steps"
          } would apply.${left}`
        : `Done: ${ran} ${ran === 1 ? "step" : "steps"} ran.`;
    setRun(id, { status: failed ? "failed" : "done", dry, message, step: failed?.step ?? -1 });
    return { script: script.text, ok: !failed, message };
  };

  return { run };
}
