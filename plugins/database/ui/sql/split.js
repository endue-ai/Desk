// A script cut into statements the way each client cuts it. PostgreSQL: a `;` outside parentheses,
// except inside the BEGIN ... END body of CREATE [OR REPLACE] FUNCTION or PROCEDURE (psql's rule,
// CASE counted inside it). MySQL and MariaDB: the current delimiter, which DELIMITER lines change.
// SQLite: a `;`, except inside the BEGIN ... END of CREATE TRIGGER. Each statement keeps where it
// stands in the script, so a client's error position lands in the editor.

import { tokenize } from "./lexer.js";

/**
 * @typedef {import("./lexer.js").Dialect} Dialect
 * @typedef {import("./lexer.js").Token} Token
 * @typedef {{ text: string, start: number, end: number, line: number, column: number, tokens: Token[] }} Statement
 *   `start` and `end` are offsets in the script; `line` and `column` count from 1.
 */

/**
 * The statements of `sql`, without the terminators, the space around them, or statements that are
 * only comments.
 * @param {string} sql
 * @param {Dialect} dialect
 * @returns {Statement[]}
 */
export function split(sql, dialect) {
  const lines = lineStarts(sql);
  /** @type {Statement[]} */
  const statements = [];
  /** @type {Token[]} */
  let current = [];
  /** @type {string[]} */
  let words = [];
  let parens = 0;
  let begins = 0;

  const flush = () => {
    const body = current.filter((t) => t.type !== "space");
    if (body.some((t) => t.type !== "comment")) {
      const first = /** @type {Token} */ (body[0]);
      const last = /** @type {Token} */ (body[body.length - 1]);
      const { line, column } = positionOf(lines, first.start);
      statements.push({
        text: sql.slice(first.start, last.end),
        start: first.start,
        end: last.end,
        line,
        column,
        tokens: current.filter((t) => t.start >= first.start && t.end <= last.end),
      });
    }
    current = [];
    words = [];
    parens = 0;
    begins = 0;
  };

  for (const token of tokenize(sql, dialect)) {
    if (token.type === "delimiter") {
      flush();
      continue;
    }
    if (token.type === "end" && (dialect === "mysql" || (parens === 0 && begins === 0))) {
      flush();
      continue;
    }
    current.push(token);
    if (token.type === "op" && token.text === "(") parens++;
    else if (token.type === "op" && token.text === ")") parens = Math.max(0, parens - 1);
    else if (token.type === "word") {
      const word = token.text.toUpperCase();
      if (words.length < 4) words.push(word);
      if (parens === 0 && hasBody(words, dialect)) {
        if (word === "BEGIN") begins++;
        else if (word === "CASE" && begins > 0) begins++;
        else if (word === "END" && begins > 0) begins--;
      }
    }
  }
  flush();
  return statements;
}

/** Whether a statement starting with `words` has a body whose `;` do not end it. */
function hasBody(/** @type {string[]} */ words, /** @type {Dialect} */ dialect) {
  const [a, b, c, d] = words;
  if (a !== "CREATE") return false;
  if (dialect === "postgresql") {
    const routine = (/** @type {string | undefined} */ w) => w === "FUNCTION" || w === "PROCEDURE";
    return routine(b) || (b === "OR" && c === "REPLACE" && routine(d));
  }
  if (dialect === "sqlite") {
    return b === "TRIGGER" || ((b === "TEMP" || b === "TEMPORARY") && c === "TRIGGER");
  }
  return false;
}

/**
 * The statement the caret is in, or else the last one that ends before it on the same line, or else
 * the next one. `undefined` for a script without statements.
 * @param {Statement[]} statements
 * @param {number} caret
 * @param {string} sql
 */
export function statementAt(statements, caret, sql) {
  const inside = statements.find((s) => caret >= s.start && caret <= s.end);
  if (inside) return inside;
  const lineStart = sql.lastIndexOf("\n", caret - 1) + 1;
  const before = [...statements].reverse().find((s) => s.end <= caret && s.end >= lineStart);
  return before ?? statements.find((s) => s.start >= caret) ?? statements[statements.length - 1];
}

/** The offset each line starts at. */
export function lineStarts(/** @type {string} */ text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** The 1-based line and column of `offset`. */
export function positionOf(/** @type {number[]} */ starts, /** @type {number} */ offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (/** @type {number} */ (starts[mid]) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - /** @type {number} */ (starts[lo]) + 1 };
}
