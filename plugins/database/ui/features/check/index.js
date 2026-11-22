// Database: check the statement without running it (PG-21, ADR 0353): the statement at the caret,
// or each one the selection holds, goes to the server's Parse and Describe on the console's session
// (under a savepoint in an open transaction) and nothing executes, so it changes nothing and works
// on a read-only connection. The console shows what each takes (its parameters and the types the
// server infers) and answers (its columns), or the server's error, which the editor's caret moves
// to. The plugin's one check without running: agents' check-statement takes the same path. No DOM.

import { numbered } from "../../editor/bind.js";
import { paramsOf } from "../../editor/params.js";
import { formatCount } from "../../format.js";
import { split, statementAt } from "../../sql/split.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/pg-describe.js").Described} Described
 * @typedef {import("../../engines/common.js").StatementOutcome & { described?: Described }} Outcome
 */

const plural = (/** @type {number} */ n, /** @type {string} */ word) =>
  `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

/** What the status line says of one statement's check. */
export function saidOf(/** @type {Outcome | undefined} */ outcome) {
  if (!outcome) return "not checked";
  if (outcome.error) return outcome.error.message;
  const described = outcome.described;
  if (!described) return "not checked";
  const takes = described.params.length
    ? `takes ${described.params.map((p) => `${p.key} ${p.type}`).join(", ")}`
    : "takes no parameters";
  const answers = described.columns
    ? `answers ${plural(described.columns.length, "column")}`
    : "answers no rows";
  return `${takes}; ${answers}`;
}

/** @param {Deps} deps */
async function check(deps) {
  const target = deps.consoles.current();
  if (target?.kind !== "console") throw new Error("Check works in a console.");
  const conn = deps.manager.get(target.connection);
  if (!conn) throw new Error("This console's connection was removed.");
  if (conn.engine !== "postgresql")
    throw new Error("Only PostgreSQL checks a statement without running it.");
  const { text, start, end } = deps.view.editor();
  const selected = start !== end;
  const sql = selected ? text.slice(start, end) : text;
  const all = split(sql, "postgresql");
  const at = selected ? undefined : statementAt(all, start, text);
  const picked = selected ? all : at ? [at] : [];
  if (picked.length === 0) throw new Error("Nothing to check: the editor holds no statement.");
  const statements = picked.map((statement) => {
    const sent = numbered(statement.text, paramsOf(statement.text, "postgresql"));
    return { ...statement, text: sent.text, keys: sent.keys, shifts: sent.shifts };
  });
  target.text = text;
  await deps.consoles.runIn(target, conn, sql, {
    mode: "describe",
    base: selected ? start : 0,
    statements,
    history: false,
  });
  const error = target.shown?.error;
  if (error) deps.view.select(error.offset, error.offset);
  const outcomes = /** @type {Outcome[]} */ (target.execution?.result.statements ?? []);
  const failure = target.execution?.result.error;
  if (failure) return `Not checked: ${failure.message}`;
  const said = outcomes.map((o, i) => (outcomes.length > 1 ? `${i + 1}: ${saidOf(o)}` : saidOf(o)));
  const line = `Checked, nothing ran: ${said.join("; ")}.`;
  // The result's own line says what the check found, not that a statement ran.
  if (target.shown) {
    target.shown.summary = line;
    deps.consoles.render();
  }
  return line;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "check",
  commands: (deps) => ({
    "endue.database.check": () => check(deps),
  }),
};
