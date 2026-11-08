// Format SQL: each clause on its own line (SELECT, FROM, WHERE, GROUP BY, JOIN ...), the select list
// and SET one item a line, AND and OR of a condition on their own lines, subqueries indented, the
// columns of CREATE TABLE one a line, reserved words in capitals. It only ever changes the space
// between tokens and the case of reserved words: strings, quoted names, comments and dollar quotes
// are written back as they were, tokens that touched still touch (so `::`, `<=` and `a.b` stay
// whole), and a line comment always ends its line. Pure.

import { tokenize } from "../sql/lexer.js";
import { reservedOf } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ kind: "sub" | "list" | "plain", base: string, clause: string }} Paren
 */

const CLAUSES = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "VALUES",
  "SET",
  "RETURNING",
  "WINDOW",
  "FETCH",
]);
const JOINS = new Set([
  "JOIN",
  "LEFT",
  "RIGHT",
  "FULL",
  "INNER",
  "CROSS",
  "NATURAL",
  "STRAIGHT_JOIN",
]);
const JOINED = new Set([...JOINS, "OUTER"]);
const CONDITIONS = new Set(["WHERE", "HAVING", "JOIN"]);
const STICKY = new Set([".", ":", "@", "$"]);
const STEP = "  ";

/**
 * @param {string} text
 * @param {Dialect} dialect
 */
export function formatSql(text, dialect) {
  const tokens = tokenize(text, dialect);
  const reserved = reservedOf(dialect);
  const significant = tokens.filter((t) => t.type !== "space");
  let out = "";
  /** @type {Paren[]} */
  let stack = [];
  let base = "";
  let clause = "";
  let cases = 0;
  let between = false;
  let first = true;
  /** A separator that must be written before the next token (after a comment or a statement). */
  let forced = "";
  /** @type {Token | undefined} */
  let previous;
  let spaced = false;
  let statementWords = /** @type {string[]} */ ([]);

  const top = () => stack[stack.length - 1];
  const atClause = () => cases === 0 && (stack.length === 0 || top()?.kind === "sub");
  const inner = () => (top()?.kind === "list" ? `${top()?.base ?? ""}${STEP}` : base);

  for (let i = 0; i < tokens.length; i++) {
    const token = /** @type {Token} */ (tokens[i]);
    if (token.type === "space") {
      spaced = true;
      continue;
    }
    const next = significant[significant.indexOf(token) + 1];
    const word = token.type === "word" ? token.text.toUpperCase() : "";
    const prevWord = previous?.type === "word" ? previous.text.toUpperCase() : "";
    const qualified =
      (previous?.type === "op" && previous.text === ".") ||
      (next?.type === "op" && next.text === ".");
    const op = token.type === "op" ? token.text : "";
    const prevOp = previous?.type === "op" ? previous.text : "";
    const loose =
      spaced ||
      ["(", ")", ","].includes(prevOp) ||
      op === ")" ||
      ((CLAUSES.has(word) || JOINS.has(word) || word === "AND" || word === "OR") && !qualified);
    const glued = !spaced && (STICKY.has(prevOp) || op === "." || op === ":");

    /** @type {string | undefined} */
    let gap;
    if (first) gap = "";
    else if (forced) gap = forced;
    else if (token.type === "end") gap = "";
    else if (token.type === "delimiter") gap = "\n";
    else if (glued || !loose) gap = spaced ? " " : "";
    else if (word === "AND" && between) {
      between = false;
      gap = " ";
    } else if (
      atClause() &&
      !qualified &&
      clauseStart(word, prevWord, next, clause, statementWords[0] ?? "")
    )
      gap = `\n${base}`;
    else if (atClause() && (word === "AND" || word === "OR") && CONDITIONS.has(clause))
      gap = `\n${base}${STEP}`;
    else if (prevOp === "," && atClause() && clause === "SELECT") gap = `\n${base}       `;
    else if (prevOp === "," && atClause() && clause === "SET") gap = `\n${base}    `;
    else if (prevOp === "," && atClause() && clause === "VALUES") gap = `\n${base}${STEP}`;
    else if (top()?.kind === "list" && (prevOp === "(" || prevOp === ","))
      gap = `\n${top()?.base}${STEP}`;
    else if (op === ")" && (top()?.kind === "list" || top()?.kind === "sub"))
      gap = `\n${top()?.base}`;
    else gap = spaced ? " " : "";
    out += gap;
    forced = "";
    spaced = false;
    first = false;

    let written = token.text;
    if (token.type === "delimiter") written = text.slice(token.start, token.end).trimEnd();
    else if (token.type === "word" && reserved.has(word) && !qualified) written = word;
    out += written;

    if (token.type === "end" || token.type === "delimiter") {
      stack = [];
      base = "";
      clause = "";
      cases = 0;
      between = false;
      statementWords = [];
      forced = token.type === "end" ? "\n\n" : "\n";
      previous = token;
      continue;
    }
    if (token.type === "comment" && token.text.startsWith("--")) forced = `\n${inner()}`;
    if (token.type === "comment" && token.text.startsWith("#")) forced = `\n${inner()}`;
    if (word) statementWords.push(word);
    if (word === "CASE") cases++;
    else if (word === "END" && cases > 0) cases--;
    else if (word === "BETWEEN") between = true;
    if (atClause() && !qualified) {
      if (CLAUSES.has(word) && clauseStart(word, prevWord, next, clause, statementWords[0] ?? ""))
        clause = word;
      else if (statementWords.length === 1 && CLAUSES.has(word)) clause = word;
      else if (JOINS.has(word) && clauseStart(word, prevWord, next, clause, "")) clause = "JOIN";
    }
    if (op === "(") {
      const sub = next?.type === "word" && /^(?:SELECT|WITH)$/iu.test(next.text);
      const list =
        !sub &&
        stack.length === 0 &&
        statementWords[0] === "CREATE" &&
        statementWords.includes("TABLE") &&
        !out.slice(0, -1).includes("(", out.lastIndexOf("\n\n") + 1);
      stack.push({ kind: sub ? "sub" : list ? "list" : "plain", base, clause });
      if (sub) base = `${base}${STEP}`;
    } else if (op === ")") {
      const closed = stack.pop();
      if (closed?.kind === "sub") {
        base = closed.base;
        clause = closed.clause;
      }
    }
    previous = token;
  }
  const lines = out.split("\n").map((line) => line.trimEnd());
  const body = lines.join("\n").trim();
  return /\n\s*$/u.test(text) ? `${body}\n` : body;
}

/**
 * Whether a word starts a clause line: a clause word where it is one (FROM after a select list, SET
 * of an UPDATE, VALUES of an INSERT), or the first word of a JOIN (LEFT( is MySQL's function).
 * @param {string} word
 * @param {string} previous The word before it, upper-cased, or "".
 * @param {Token | undefined} next
 * @param {string} clause The clause it stands in.
 * @param {string} verb The statement's first word.
 */
function clauseStart(word, previous, next, clause, verb) {
  const nextWord = next?.type === "word" ? next.text.toUpperCase() : "";
  if (JOINS.has(word))
    return word === "JOIN" ? !JOINED.has(previous) : JOINED.has(nextWord) && !JOINED.has(previous);
  if (!CLAUSES.has(word) || previous === "DISTINCT") return false;
  if (word === "FROM") return clause === "SELECT";
  if (word === "SET") return verb === "UPDATE" || previous === "UPDATE";
  if (word === "VALUES") return verb === "INSERT" || verb === "REPLACE";
  return true;
}
