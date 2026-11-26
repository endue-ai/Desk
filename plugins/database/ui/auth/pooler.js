// A PostgreSQL connection marked "through a pooler" (PG-14, ADR 0354, docs/password-command.md): a
// pooler in transaction mode lends a server connection for one transaction at a time, so what a
// session keeps between transactions may be gone at the next. On such a connection the plugin signs
// in with the application name alone (a pooler refuses or drops other startup parameters, the
// statement timeout and the read-only default among them: the plugin's own stop and its read-only
// guard hold them instead), keeps no setting on a session with SET, and refuses in words, before
// anything is sent, a statement that leaves state on the session: SET or RESET outside a
// transaction's own, LISTEN, a prepared statement, a cursor WITH HOLD, a temporary table that
// outlives its transaction, a session-level advisory lock, DISCARD and LOAD. What still works:
// reads, runs, a statement's pages (the core holds its portal until the statement's end), edits,
// explicit transactions, SET LOCAL and the catalog. No DOM.

import { wordsOf } from "../sql/lexer.js";
import { t as messageText } from "../strings/index.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../sql/split.js").Statement} Statement
 */

/** Whether the connection goes through a pooler in transaction mode. */
export const pooled = (/** @type {Connection | undefined} */ conn) =>
  conn?.engine === "postgresql" && /** @type {{ pooler?: boolean }} */ (conn).pooler === true;

/** The startup parameters a session through a pooler signs in with: its application name only. */
export const pooledSettings = (/** @type {Connection} */ conn, /** @type {string} */ fallback) => ({
  application_name: conn.applicationName || fallback,
});

const STATE = "keeps state on the session, which the pooler may hand to someone else";
/**
 * Each rule: the statement's first words, and what to write instead (empty: nothing does).
 * @type {Array<[test: (w: string[], text: string) => boolean, verb: string, instead: string]>}
 */
const RULES = [
  [
    (w) => w[0] === "SET" && w[1] !== "LOCAL" && w[1] !== "TRANSACTION" && w[1] !== "CONSTRAINTS",
    "SET",
    "SET LOCAL inside a transaction lasts as long as it.",
  ],
  [(w) => w[0] === "RESET", "RESET", ""],
  [(w) => w[0] === "LISTEN" || w[0] === "UNLISTEN", "LISTEN", ""],
  [
    (w) => w[0] === "PREPARE" && w[1] !== "TRANSACTION",
    "PREPARE",
    messageText("auth.pooler.runTheStatementItself"),
  ],
  [(w) => w[0] === "EXECUTE" || w[0] === "DEALLOCATE", "a prepared statement", ""],
  [(w, t) => w[0] === "DECLARE" && /\bwith\s+hold\b/iu.test(t), "DECLARE WITH HOLD", ""],
  [
    (w, t) =>
      w[0] === "CREATE" &&
      (w[1] === "TEMP" || w[1] === "TEMPORARY" || w[2] === "TEMP" || w[2] === "TEMPORARY") &&
      !/\bon\s+commit\s+drop\b/iu.test(t),
    "CREATE TEMPORARY",
    messageText("auth.pooler.addOnCommitDropAndRun"),
  ],
  [(w) => w[0] === "DISCARD" || w[0] === "LOAD", "DISCARD or LOAD", ""],
  [
    (_, t) => /\bpg_(?:try_)?advisory_lock(?:_shared)?\s*\(/iu.test(t),
    "a session advisory lock",
    messageText("auth.pooler.pgAdvisoryXactLockLastsAs"),
  ],
];

/**
 * Why a run may not go to a connection through a pooler: the first statement that keeps session
 * state, in words; "" when every statement may.
 * @param {Connection} conn
 * @param {Statement[]} statements
 */
export function pooledRefusal(conn, statements) {
  if (!pooled(conn)) return "";
  for (const [i, statement] of statements.entries()) {
    const words = wordsOf(statement.tokens ?? [], true);
    const rule = RULES.find(([test]) => test(words, statement.text));
    if (!rule) continue;
    const [, verb, instead] = rule;
    return `${conn.name} goes through a pooler: statement ${i + 1} (${verb}) ${STATE}.${instead ? ` ${instead}` : ""}`;
  }
  return "";
}

/** The session options a connection through a pooler cannot keep, by the form's words. */
const DROPPED = /** @type {const} */ ([
  ["searchPath", "Search path"],
  ["role", "Role"],
  ["timeZone", "Time zone"],
  ["lockTimeout", "Lock timeout"],
  ["idleTimeout", "Idle in transaction timeout"],
  ["startup", "Startup script"],
]);

/** Throws the sentence why the connection's options cannot go through a pooler. */
export function checkPooled(/** @type {Connection} */ conn) {
  if (!pooled(conn)) return;
  const fields = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (conn));
  const kept = DROPPED.find(([key]) => fields[key]);
  if (kept)
    throw new Error(
      messageText("auth.pooler.aConnectionThroughAPoolerKeeps", { value: String(kept[1]) }),
    );
}
