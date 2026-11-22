// A cursor over one statement's tokens for reading DDL files (PG-53): words compared folded, names
// read as PostgreSQL folds them, a parenthesised group or a run of tokens taken back as the text it
// was written in. Pure.

import { tokenize } from "../../sql/lexer.js";
import { nameOf } from "./normalize.js";

/** @typedef {import("../../sql/lexer.js").Token} Token */

/** @param {string} text */
export function cursor(text) {
  const tokens = tokenize(text, "postgresql").filter(
    (t) => t.type !== "space" && t.type !== "comment" && t.type !== "end",
  );
  let i = 0;
  /** A token as compared: a word in lower case, anything else as written. */
  const word = (/** @type {Token | undefined} */ t) =>
    t ? (t.type === "word" ? t.text.toLowerCase() : t.text) : "";
  const c = {
    text,
    get done() {
      return i >= tokens.length;
    },
    get at() {
      return tokens[i]?.start ?? text.length;
    },
    peek: (k = 0) => word(tokens[i + k]),
    /** Whether the next tokens are these words, in this order. */
    is: (/** @type {string[]} */ ...words) => words.every((w, k) => word(tokens[i + k]) === w),
    /** Take these words when they come next. */
    take(/** @type {string[]} */ ...words) {
      if (!c.is(...words)) return false;
      i += words.length;
      return true;
    },
    /** One name as PostgreSQL folds it ("" when none comes). */
    one() {
      const t = tokens[i];
      const n = t ? nameOf(t) : undefined;
      if (n === undefined) return "";
      i++;
      return n;
    },
    /** A name with its schema when written: `{ schema: "", name }` otherwise. */
    qualified() {
      const first = c.one();
      if (c.peek() !== ".") return { schema: "", name: first };
      i++;
      return { schema: first, name: c.one() };
    },
    /** A parenthesised group's inner text (undefined when no group comes). */
    group() {
      if (c.peek() !== "(") return undefined;
      const open = /** @type {Token} */ (tokens[i]);
      let depth = 0;
      for (let j = i; j < tokens.length; j++) {
        const w = tokens[j]?.text;
        if (w === "(") depth++;
        else if (w === ")" && --depth === 0) {
          const inner = text.slice(open.end, tokens[j]?.start);
          i = j + 1;
          return inner;
        }
      }
      i = tokens.length;
      return text.slice(open.end);
    },
    /** The text from here to the first top-level word of `stop` (or the end). */
    until(/** @type {Set<string>} */ stop) {
      const from = c.at;
      let depth = 0;
      while (i < tokens.length) {
        const w = word(tokens[i]);
        if (depth === 0 && stop.has(w)) break;
        if (w === "(" || w === "[") depth++;
        else if (w === ")" || w === "]") depth--;
        i++;
      }
      return text.slice(from, c.at).trim();
    },
    /** What is left, as written. */
    rest() {
      const from = c.at;
      i = tokens.length;
      return text.slice(from).trim();
    },
  };
  return c;
}

/** A list's top-level items, as written: `a, (b, c), d` is three. */
export function items(/** @type {string} */ list) {
  /** @type {string[]} */
  const out = [];
  const tokens = tokenize(list, "postgresql");
  let depth = 0;
  let from = 0;
  for (const t of tokens) {
    if (t.text === "(" || t.text === "[") depth++;
    else if (t.text === ")" || t.text === "]") depth--;
    else if (t.text === "," && depth === 0) {
      out.push(list.slice(from, t.start).trim());
      from = t.end;
    }
  }
  const last = list.slice(from).trim();
  if (last) out.push(last);
  return out;
}

/** A string literal's value: 'it''s' is it's, E'a\nb' unescaped. */
export function literal(/** @type {string} */ text) {
  const t = text.trim();
  const e = /^[eE]'/u.test(t);
  const inner = t.slice(e ? 2 : 1, -1).replaceAll("''", "'");
  return e
    ? inner.replace(/\\(.)/gsu, (_, ch) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch))
    : inner;
}
