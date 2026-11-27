// Syntax highlighting: the lexer's tokens as runs of text with a class each (keyword, function,
// string, number, comment, name, param, op), so the view only marks them. The lexer is the one
// statements are cut with, so what is drawn as a string or a comment is what the client reads as
// one. `highlight` takes a whole text; `runsOf` takes tokens the editor lexed from a checkpoint
// (tokens.js) and gives the same kinds for a range of a text of any size. Pure.

import { tokenize } from "../sql/lexer.js";
import { functionsOf, keywordsOf } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {"keyword" | "function" | "string" | "number" | "comment" | "name" | "param" | "variable" | "op" | "plain"} Kind
 * @typedef {{ text: string, kind: Kind }} Run
 * @typedef {{ from: number, to: number, kind: Kind }} Span
 */

/** @type {Map<Dialect, Set<string>>} */
const functionSets = new Map();

function functionSet(/** @type {Dialect} */ dialect) {
  let functions = functionSets.get(dialect);
  if (!functions) {
    functions = new Set(functionsOf(dialect));
    functionSets.set(dialect, functions);
  }
  return functions;
}

/**
 * The kind token `i` is drawn as: a word is a function right before `(`, a keyword unless it
 * follows a `.`.
 * @param {Token[]} tokens @param {number} i @param {Dialect} dialect
 * @returns {Kind}
 */
export function kindOf(tokens, i, dialect) {
  const token = /** @type {Token} */ (tokens[i]);
  if (token.type === "word") {
    const next = tokens[i + 1];
    const called = next?.type === "op" && next.text === "(";
    const previous = tokens[i - 1];
    const qualified = previous?.type === "op" && previous.text === ".";
    if (!qualified && called && functionSet(dialect).has(token.text.toLowerCase()))
      return "function";
    if (!qualified && keywordsOf(dialect).has(token.text.toUpperCase())) return "keyword";
    return "plain";
  }
  if (token.type === "delimiter") return "keyword";
  if (token.type === "end") return "op";
  if (token.type === "space") return "plain";
  return token.type;
}

/**
 * @param {string} text
 * @param {Dialect} dialect
 * @returns {Run[]} Adjacent runs of one kind are joined; concatenated they give `text` back.
 */
export function highlight(text, dialect) {
  /** @type {Run[]} */
  const runs = [];
  const tokens = tokenize(text, dialect);
  tokens.forEach((token, i) => {
    const kind = kindOf(tokens, i, dialect);
    // A DELIMITER line's token holds the delimiter only; the run keeps the whole line.
    const source = text.slice(token.start, token.end);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += source;
    else runs.push({ text: source, kind });
  });
  return runs;
}

/**
 * The spans of `from`..`to` that are not plain, from tokens that cover it (and one token on each
 * side, which decides a word's kind). Adjacent spans of one kind are joined.
 * @param {Token[]} tokens @param {Dialect} dialect @param {number} from @param {number} to
 * @returns {Span[]}
 */
export function runsOf(tokens, dialect, from, to) {
  /** @type {Span[]} */
  const spans = [];
  tokens.forEach((token, i) => {
    if (token.end <= from || token.start >= to) return;
    const kind = kindOf(tokens, i, dialect);
    if (kind === "plain") return;
    const start = Math.max(from, token.start);
    const end = Math.min(to, token.end);
    const last = spans[spans.length - 1];
    if (last && last.kind === kind && last.to === start) last.to = end;
    else spans.push({ from: start, to: end, kind });
  });
  return spans;
}
