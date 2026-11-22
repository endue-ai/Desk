// What a proposal is before the person takes it (PG-90): the marks of its statements, by the same
// classification the guards use (a write, a schema change, what is dangerous, what no client may
// run here, what a read-only or production connection does with it), and the server's check.
// The server is asked to plan each statement with EXPLAIN (EXPLAIN QUERY PLAN on SQLite), which
// never runs it, as the plugin's own read; a statement EXPLAIN does not take, or one with
// parameters, is offered as not checked, and so is everything after it. A proposal taken into the
// console runs only when the person runs it, under every guard a typed statement passes.

import { engineOf } from "../../engines/index.js";
import { classify } from "../../sql/classify.js";
import { split } from "../../sql/split.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ state: "ok" | "refused" | "unchecked", text: string }} ServerCheck
 * @typedef {{ write: boolean, marks: string[] }} Marks
 */

/** The verbs EXPLAIN plans without running. */
const EXPLAINED = new Set([
  "SELECT",
  "WITH",
  "VALUES",
  "TABLE",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
]);
const KINDS = /** @type {Record<string, string>} */ ({
  write: "Writes",
  ddl: "Changes the schema",
  transaction: "Controls a transaction",
  session: "Changes the session",
});

/**
 * The marks of a proposal's text on a connection.
 * @param {Pick<Connection, "engine" | "readOnly" | "tag">} conn
 * @param {string} text
 * @returns {Marks}
 */
export function marksOf(conn, text) {
  const { dialect } = engineOf(conn.engine);
  /** @type {string[]} */
  const marks = [];
  let write = false;
  for (const statement of split(text, dialect)) {
    const c = classify(statement, dialect);
    if (c.refused) marks.push(c.refused);
    if (c.kind === "read") continue;
    if (c.kind === "write" || c.kind === "ddl") write = true;
    marks.push(`${KINDS[c.kind] ?? "Writes"}: ${c.verb}`);
    if (c.dangerous) marks.push(c.dangerous);
  }
  if (write && conn.readOnly) marks.push("This connection is read-only: a run refuses this write.");
  else if (write && conn.tag === "production")
    marks.push("This connection is tagged production: a run asks before it writes.");
  return { write, marks: [...new Set(marks)] };
}

/** How the server is asked to plan a statement. */
const explainOf = (/** @type {string} */ dialect) =>
  dialect === "sqlite" ? "EXPLAIN QUERY PLAN" : "EXPLAIN";

/**
 * Ask the server to plan each statement of a proposal, in order, without running any.
 * @param {import("../../feature-host.js").Deps} deps
 * @param {Connection} conn
 * @param {string} text
 * @returns {Promise<ServerCheck>}
 */
export async function checkWithServer(deps, conn, text) {
  const { dialect } = engineOf(conn.engine);
  const statements = split(text, dialect);
  if (!statements.length) return { state: "unchecked", text: "Nothing to check." };
  let checked = 0;
  for (const statement of statements) {
    const c = classify(statement, dialect);
    const why = c.refused
      ? c.refused
      : !EXPLAINED.has(c.verb)
        ? `the server plans only reads and writes of rows, not ${c.verb}`
        : statement.tokens.some((t) => t.type === "param")
          ? "it has parameters"
          : "";
    if (why) {
      const rest = checked ? `the first ${checked} checked; ` : "";
      return { state: "unchecked", text: `Not checked by the server: ${rest}${why}.` };
    }
    try {
      const done = await deps.execute(conn, `${explainOf(dialect)} ${statement.text}`, {
        catalog: true,
        interactive: false,
        maxRows: 1,
      });
      const error = done.result.error ?? done.result.statements[0]?.error;
      if (error) return { state: "refused", text: `The server refuses it: ${error.message}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { state: "unchecked", text: `Not checked by the server: ${message}` };
    }
    checked++;
  }
  return {
    state: "ok",
    text: `Checked by the server (${explainOf(dialect)}): it plans, and nothing ran.`,
  };
}
