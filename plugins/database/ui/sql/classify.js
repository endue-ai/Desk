// What a statement does, from its words: read, write, ddl, transaction or session, whether it returns
// rows, whether it is dangerous (DROP, TRUNCATE, UPDATE or DELETE without WHERE), and what no client
// may run here (psql meta-commands, sqlite3 dot-commands, COPY through standard input or output).
// Unknown statements count as writes, so a read-only connection refuses them.

import { wordsOf } from "./lexer.js";

/**
 * @typedef {import("./lexer.js").Dialect} Dialect
 * @typedef {import("./split.js").Statement} Statement
 * @typedef {"read" | "write" | "ddl" | "transaction" | "session"} Kind
 * @typedef {{ kind: Kind, verb: string, rows: boolean, dangerous: string, refused: string, opensWrite: boolean }} Class
 *   `dangerous` and `refused` are the sentence to show, empty when neither; `opensWrite` marks a
 *   statement that would switch a read-only session to writing.
 */

const READ = new Set(["SELECT", "VALUES", "TABLE", "SHOW", "DESCRIBE", "DESC", "FETCH", "MOVE"]);
const WRITE = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "UPSERT", "COPY", "CALL"]);
const DDL = new Set([
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "RENAME",
  "COMMENT",
  "GRANT",
  "REVOKE",
  "REINDEX",
  "CLUSTER",
  "VACUUM",
  "ANALYZE",
  "ANALYSE",
  "REFRESH",
  "IMPORT",
  "SECURITY",
  "ATTACH",
  "DETACH",
  "OPTIMIZE",
  "REPAIR",
]);
const TRANSACTION = new Set([
  "BEGIN",
  "START",
  "COMMIT",
  "END",
  "ROLLBACK",
  "ABORT",
  "SAVEPOINT",
  "RELEASE",
  "XA",
]);
const SESSION = new Set([
  "SET",
  "RESET",
  "USE",
  "DISCARD",
  "LISTEN",
  "UNLISTEN",
  "DEALLOCATE",
  "PREPARE",
  "DECLARE",
  "CLOSE",
  "LOCK",
  "UNLOCK",
  "CHECKPOINT",
  "LOAD",
]);
const MAIN_VERBS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "VALUES", "TABLE"]);
const READ_ONLY_NAMES =
  /\b(?:transaction_read_only|default_transaction_read_only|read_only|tx_read_only)\b/iu;

/**
 * @param {Statement} statement
 * @param {Dialect} dialect
 * @returns {Class}
 */
export function classify(statement, dialect) {
  const significant = statement.tokens.filter((t) => t.type !== "space" && t.type !== "comment");
  const first = significant[0];
  const refused = refusal(first?.text ?? "", statement, dialect);
  const words = wordsOf(statement.tokens);
  const top = wordsOf(statement.tokens, true);
  let verb = words[0] ?? (first?.text === "(" ? "SELECT" : "");
  let rest = top;
  if (verb === "WITH") {
    // A data-modifying CTE (PostgreSQL: WITH x AS (DELETE ... RETURNING *) SELECT ...) writes.
    const nested = words.find(
      (w) => w === "INSERT" || w === "UPDATE" || w === "DELETE" || w === "MERGE",
    );
    verb = nested ?? top.find((w) => MAIN_VERBS.has(w)) ?? "SELECT";
    rest = nested ? words.slice(words.indexOf(nested)) : top.slice(top.indexOf(verb));
  }
  if (verb === "EXPLAIN") return explained(words, top, dialect, refused);
  // PRAGMA name = value sets something; PRAGMA name or name(arg) reads.
  const assigns = statement.tokens.some((t) => t.type === "op" && t.text === "=");
  const kind = verb === "PRAGMA" ? (assigns ? "session" : "read") : kindOf(verb, rest, dialect);
  return {
    kind,
    verb,
    rows: returnsRows(verb, rest, words, dialect),
    dangerous: danger(verb, rest, words),
    refused,
    opensWrite: opensWrite(verb, words, statement.text),
  };
}

/** EXPLAIN reads, unless ANALYZE runs the statement it explains. */
function explained(
  /** @type {string[]} */ words,
  /** @type {string[]} */ top,
  /** @type {Dialect} */ dialect,
  /** @type {string} */ refused,
) {
  const at = words.findIndex((w, i) => i > 0 && (MAIN_VERBS.has(w) || WRITE.has(w)));
  const inner = words[at];
  const analyze = words.slice(1, at).some((w) => w === "ANALYZE" || w === "ANALYSE");
  const rest = inner ? top.slice(Math.max(0, top.indexOf(inner))) : top;
  const kind = analyze && inner ? kindOf(inner, rest, dialect) : "read";
  return { kind, verb: "EXPLAIN", rows: true, dangerous: "", refused, opensWrite: false };
}

/** @returns {Kind} */
function kindOf(
  /** @type {string} */ verb,
  /** @type {string[]} */ top,
  /** @type {Dialect} */ dialect,
) {
  if (verb === "SELECT") return top.includes("INTO") ? "write" : "read";
  if (verb === "SHOW" && dialect === "mysql" && top[1] === "CREATE") return "read";
  if (READ.has(verb)) return "read";
  if (WRITE.has(verb) || verb === "DO" || verb === "EXECUTE") return "write";
  if (DDL.has(verb)) return "ddl";
  if (TRANSACTION.has(verb))
    return verb === "START" && top[1] !== "TRANSACTION" ? "write" : "transaction";
  if (SESSION.has(verb)) return verb === "LOAD" ? "write" : "session";
  return "write";
}

function returnsRows(
  /** @type {string} */ verb,
  /** @type {string[]} */ top,
  /** @type {string[]} */ words,
  /** @type {Dialect} */ dialect,
) {
  if (verb === "SELECT") return !top.includes("INTO");
  if (READ.has(verb) || verb === "PRAGMA" || verb === "CALL") return true;
  if (WRITE.has(verb)) return words.includes("RETURNING");
  return dialect === "mysql" && (verb === "CHECK" || verb === "HELP");
}

/** The sentence to show before a dangerous statement runs, or "". */
function danger(
  /** @type {string} */ verb,
  /** @type {string[]} */ top,
  /** @type {string[]} */ words,
) {
  if (verb === "DROP") return `DROP ${top[1] ?? ""} removes it for good.`.replace("  ", " ");
  if (verb === "TRUNCATE") return "TRUNCATE removes every row.";
  if ((verb === "DELETE" || verb === "UPDATE") && !top.includes("WHERE"))
    return `${verb} without WHERE changes every row.`;
  if (verb === "ALTER" && words.includes("DROP"))
    return "ALTER ... DROP removes part of it for good.";
  return "";
}

/** Statements that would turn a read-only session into a writing one. */
function opensWrite(
  /** @type {string} */ verb,
  /** @type {string[]} */ words,
  /** @type {string} */ text,
) {
  const readWrite = words.some((w, i) => w === "READ" && words[i + 1] === "WRITE");
  if ((verb === "BEGIN" || verb === "START" || verb === "SET") && readWrite) return true;
  return (verb === "SET" || verb === "RESET") && READ_ONLY_NAMES.test(text);
}

/** What a client would do with this statement that it must not do here, or "". */
function refusal(
  /** @type {string} */ first,
  /** @type {Statement} */ statement,
  /** @type {Dialect} */ dialect,
) {
  if (dialect === "postgresql" && statement.text.startsWith("\\"))
    return "psql meta-commands (\\...) do not run here; use the terminal.";
  if (dialect === "sqlite" && statement.text.startsWith("."))
    return "sqlite3 dot-commands (.tables, .import ...) do not run here; use the terminal.";
  if (dialect === "postgresql" && first.toUpperCase() === "COPY") {
    const top = wordsOf(statement.tokens, true);
    if (top.includes("STDIN") || top.includes("STDOUT"))
      return "COPY through standard input or output needs psql's terminal; use the terminal.";
  }
  if (dialect === "mysql" && statement.text.startsWith("\\"))
    return "mysql client commands (\\...) do not run here; use the terminal.";
  return "";
}

/** Whether no statement writes, so a read-only connection or an agent may run them all. */
export function readsOnly(/** @type {Class[]} */ classes) {
  return classes.every((c) => c.kind !== "write" && c.kind !== "ddl" && !c.opensWrite);
}
