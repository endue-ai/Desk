// What the refactorings (PG-33) read of a statement's tokens beside the resolver's names: the
// significant tokens (navigate/target.js's), where each parenthesis closes, a WITH list's entries,
// the alias after a FROM item, a name written the way PostgreSQL reads it back, and edits applied to
// a text. Pure.

import { PG_RESERVED } from "../editor/words.js";
import { identOf, significant } from "../navigate/target.js";
import { quoteName } from "../sql/quote.js";

export { identOf, significant };

/**
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ from: number, to: number, insert: string }} Edit
 * @typedef {{ name: string, nameAt: number, start: number, end: number, open: number,
 *   close: number, columns: boolean, materialized: "yes" | "no" | null }} WithEntry
 *   Token indexes: `nameAt` the CTE's name, `open` and `close` its body's parentheses, `end` its
 *   last token (`close`); `start` is `nameAt`.
 * @typedef {{ at: number, recursive: boolean, entries: WithEntry[] }} WithList
 */

/** Words after a FROM item that are no alias. */
export const CLAUSE = new Set(
  (
    "on using where group having window order limit offset fetch for union intersect except join " +
    "inner left right full cross natural lateral returning set from into values select when then " +
    "else end and or not tablesample with as"
  ).split(" "),
);

/** A name as PostgreSQL reads it back: bare when it is plain lower case and no reserved word. */
export function written(/** @type {string} */ name) {
  return /^[a-z_][a-z0-9_$]*$/u.test(name) && !PG_RESERVED.has(name)
    ? name
    : quoteName("postgresql", name);
}

/** A name the person typed: inside double quotes as written there, else as typed (ADR 0312). */
export function typed(/** @type {string} */ text) {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"'))
    return t.slice(1, -1).replaceAll('""', '"');
  return t;
}

/** Where each `(` closes, by token index, and the index of the `(` around each token (-1: none). */
export function pairsOf(/** @type {Token[]} */ tokens) {
  /** @type {Map<number, number>} */
  const close = new Map();
  const around = new Array(tokens.length).fill(-1);
  /** @type {number[]} */
  const open = [];
  for (const [i, t] of tokens.entries()) {
    around[i] = open.at(-1) ?? -1;
    if (t.text === "(") open.push(i);
    else if (t.text === ")") {
      const o = open.pop();
      if (o !== undefined) close.set(o, i);
      around[i] = open.at(-1) ?? -1;
    }
  }
  return { close, around };
}

/**
 * The WITH list that starts at token `at` (the WITH word), or null.
 * @param {Token[]} tokens significant tokens
 * @param {Map<number, number>} close
 * @param {number} at
 * @returns {WithList | null}
 */
export function withListAt(tokens, close, at) {
  if (identOf(tokens[at]) !== "with") return null;
  let i = at + 1;
  const recursive = identOf(tokens[i]) === "recursive";
  if (recursive) i++;
  /** @type {WithEntry[]} */
  const entries = [];
  for (;;) {
    const nameAt = i;
    const name = identOf(tokens[i]);
    if (name === undefined) return null;
    i++;
    const columns = tokens[i]?.text === "(";
    if (columns) i = (close.get(i) ?? i) + 1;
    if (identOf(tokens[i]) !== "as") return null;
    i++;
    /** @type {WithEntry["materialized"]} */
    let materialized = null;
    if (identOf(tokens[i]) === "not" && identOf(tokens[i + 1]) === "materialized") {
      materialized = "no";
      i += 2;
    } else if (identOf(tokens[i]) === "materialized") {
      materialized = "yes";
      i++;
    }
    if (tokens[i]?.text !== "(") return null;
    const open = i;
    const shut = close.get(i);
    if (shut === undefined) return null;
    entries.push({
      name,
      nameAt,
      start: nameAt,
      end: shut,
      open,
      close: shut,
      columns,
      materialized,
    });
    i = shut + 1;
    if (tokens[i]?.text !== ",") break;
    i++;
  }
  return { at, recursive, entries };
}

/**
 * The alias written after a FROM item whose last token is `last`: its token index, or -1.
 * @param {Token[]} tokens
 * @param {number} last
 */
export function aliasAfter(tokens, last) {
  let i = last + 1;
  if (identOf(tokens[i]) === "as") i++;
  const word = identOf(tokens[i]);
  if (word === undefined) return -1;
  if (tokens[i]?.type === "word" && CLAUSE.has(word)) return -1;
  return i;
}

/** The index of the significant token that starts at an offset, or -1. */
export const tokenStarting = (/** @type {Token[]} */ tokens, /** @type {number} */ offset) =>
  tokens.findIndex((t) => t.start === offset);

/** Edits applied to a text, the last first; overlapping edits are a bug of the caller's. */
export function applyEdits(/** @type {string} */ text, /** @type {Edit[]} */ edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from || b.to - a.to))
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** The line an offset is on, from 1. */
export function lineAt(/** @type {string} */ text, /** @type {number} */ at) {
  let line = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) line++;
  return line;
}
