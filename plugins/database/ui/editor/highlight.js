// Syntax highlighting: the lexer's tokens as runs of text with a class each (keyword, function,
// string, number, comment, name, param, op), so the view only wraps them in spans. The lexer is the
// one statements are cut with, so what is drawn as a string or a comment is what the client reads
// as one. Pure.

import { tokenize } from "../sql/lexer.js";
import { functionsOf, keywordsOf } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {"keyword" | "function" | "string" | "number" | "comment" | "name" | "param" | "op" | "plain"} Kind
 * @typedef {{ text: string, kind: Kind }} Run
 */

/** @type {Map<Dialect, Set<string>>} */
const functionSets = new Map();

/**
 * @param {string} text
 * @param {Dialect} dialect
 * @returns {Run[]} Adjacent runs of one kind are joined; concatenated they give `text` back.
 */
export function highlight(text, dialect) {
  const keywords = keywordsOf(dialect);
  let functions = functionSets.get(dialect);
  if (!functions) {
    functions = new Set(functionsOf(dialect));
    functionSets.set(dialect, functions);
  }
  /** @type {Run[]} */
  const runs = [];
  const tokens = tokenize(text, dialect);
  tokens.forEach((token, i) => {
    /** @type {Kind} */
    let kind = "plain";
    if (token.type === "word") {
      const next = tokens[i + 1];
      const called = next?.type === "op" && next.text === "(";
      const previous = tokens[i - 1];
      const qualified = previous?.type === "op" && previous.text === ".";
      if (!qualified && called && functions.has(token.text.toLowerCase())) kind = "function";
      else if (!qualified && keywords.has(token.text.toUpperCase())) kind = "keyword";
    } else if (token.type === "delimiter") kind = "keyword";
    else if (token.type === "end") kind = "op";
    else if (token.type !== "space") kind = token.type;
    // A DELIMITER line's token holds the delimiter only; the run keeps the whole line.
    const source = text.slice(token.start, token.end);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += source;
    else runs.push({ text: source, kind });
  });
  return runs;
}
