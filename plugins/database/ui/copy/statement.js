// Which way a PostgreSQL COPY moves rows through the session (PG-23): `in` for COPY ... FROM STDIN,
// `out` for COPY ... TO STDOUT, from its top-level words; a COPY to or from a file or a program on
// the server is neither, and runs as any write. COPY ... TO STDOUT reads unless its query writes
// (INSERT, UPDATE, DELETE or MERGE with RETURNING). No DOM.

import { wordsOf } from "../sql/lexer.js";

/**
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {"in" | "out"} Direction
 */

const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

/**
 * The way a COPY through standard input or output goes, or undefined for any other statement.
 * @param {Statement} statement
 * @returns {Direction | undefined}
 */
export function copyOf(statement) {
  const top = wordsOf(statement.tokens, true);
  if (top[0] !== "COPY") return undefined;
  if (top.includes("FROM") && top.includes("STDIN")) return "in";
  if (top.includes("TO") && top.includes("STDOUT")) return "out";
  return undefined;
}

/** Whether a COPY ... TO STDOUT's query changes data. */
export function copyWrites(/** @type {Statement} */ statement) {
  return wordsOf(statement.tokens).some((word) => WRITES.has(word));
}
