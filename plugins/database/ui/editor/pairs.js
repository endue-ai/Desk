// What pairs up in a script, read from the lexer's tokens (tokens.js), so a bracket inside a string
// or a comment is never matched: the bracket or quote at the caret and its partner, and the ranges
// lines fold (a statement over several lines, a block comment or a string over several lines, a
// parenthesized group, a PL/pgSQL body's blocks: plpgsql.js). Pure.

import { bodyFolds } from "./plpgsql.js";

/**
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {import("./tokens.js").Lexed} Lexed
 * @typedef {{ from: number, to: number }} Range
 * @typedef {{ start: Range, end: Range | null }} Pair `end` null: nothing closes it
 * @typedef {{ start: number, end: number | null }} Line
 */

/** How far a bracket's partner is looked for, each way. */
export const REACH = 10000;
/** How far past the lines asked about a statement or a group may end and still fold. */
export const FOLD_REACH = 32 * 1024;
const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = { ")": "(", "]": "[", "}": "{" };
/** A quoted token's opening: its prefix (E, B, X, N, U&, _charset) and its quote or dollar tag. */
const OPENING = /^((?:[EeBbXxNn]|[Uu]&|_[A-Za-z0-9_]+)?)(['"`[]|\$[^$]*\$)/u;

const isOpen = (/** @type {Token} */ t) => t.type === "op" && t.text in OPEN;
const isClose = (/** @type {Token} */ t) => t.type === "op" && t.text in CLOSE;
const quoted = (/** @type {Token} */ t) => t.type === "string" || t.type === "name";
const significant = (/** @type {Token} */ t) => t.type !== "space" && t.type !== "comment";
const ends = (/** @type {Token} */ t) => t.type === "end" || t.type === "delimiter";

/** The quote spans of a string or quoted name; `end` null when it is not closed. */
export function quotesOf(/** @type {Token} */ token) {
  const match = OPENING.exec(token.text);
  if (!match) return null;
  const prefix = match[1]?.length ?? 0;
  const quote = /** @type {string} */ (match[2]);
  const start = token.start + prefix;
  const close = quote === "[" ? "]" : quote;
  const closed =
    token.text.length - prefix - quote.length >= close.length && token.text.endsWith(close);
  return {
    start: { from: start, to: start + quote.length },
    end: closed ? { from: token.end - close.length, to: token.end } : null,
  };
}

/** The partner of the bracket token at `index`, scanning the way it opens or closes. */
function partner(/** @type {Token[]} */ tokens, /** @type {number} */ index) {
  const token = /** @type {Token} */ (tokens[index]);
  const opens = isOpen(token);
  const theirs = opens
    ? OPEN[/** @type {keyof typeof OPEN} */ (token.text)]
    : CLOSE[/** @type {keyof typeof CLOSE} */ (token.text)];
  let depth = 0;
  const step = opens ? 1 : -1;
  for (let i = index + step; i >= 0 && i < tokens.length; i += step) {
    const t = /** @type {Token} */ (tokens[i]);
    if (Math.abs(t.start - token.start) > REACH) break;
    if (t.type !== "op") continue;
    if (t.text === token.text) depth++;
    else if (t.text === theirs && depth-- === 0) return t;
  }
  return undefined;
}

/**
 * The bracket or quote touching `pos` and its partner: a bracket right before or after `pos`
 * first, else a string or quoted name whose quote `pos` touches.
 * @param {Lexed} lexed @param {number} pos
 * @returns {Pair | null}
 */
export function pairAt(lexed, pos) {
  const n = lexed.source.length;
  const { tokens } = lexed.tokens(Math.max(0, pos - REACH), Math.min(n, pos + REACH));
  const near = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {Token} */ (tokens[i]);
    if (t.start > pos) break;
    if (t.end >= pos) near.push(i);
  }
  for (const i of near) {
    const t = /** @type {Token} */ (tokens[i]);
    if ((!isOpen(t) && !isClose(t)) || (t.end !== pos && t.start !== pos)) continue;
    const other = partner(tokens, i);
    const here = { from: t.start, to: t.end };
    const there = other ? { from: other.start, to: other.end } : null;
    if (!there) return { start: here, end: null };
    return isOpen(t) ? { start: here, end: there } : { start: there, end: here };
  }
  const touches = (/** @type {Range | null} */ r) => r !== null && r.from <= pos && pos <= r.to;
  for (const i of near) {
    const t = /** @type {Token} */ (tokens[i]);
    const quotes = quoted(t) ? quotesOf(t) : null;
    if (quotes && (touches(quotes.start) || touches(quotes.end))) return quotes;
  }
  return null;
}

/**
 * The folds of the lines that start in `from`..`to`, by the position each line starts at: the last
 * statement that starts on a line and ends on a later one (up to its terminator), else a block
 * comment or a string that goes on past it, else its outermost bracket closed on a later line.
 * @param {Lexed} lexed @param {number} from @param {number} to
 * @returns {Map<number, Range>}
 */
export function foldsIn(lexed, from, to) {
  const n = lexed.source.length;
  const last = Math.min(n, to + FOLD_REACH);
  const { tokens } = lexed.tokens(from, last);
  const first = tokens[0];
  const point = lexed.pointBefore(first ? first.start : from);
  /** @type {Map<number, Range>} */
  const statements = new Map();
  /** @type {Map<number, Range>} */
  const others = new Map();
  /** @type {Map<number, Range>} */
  const groups = new Map();
  /** @type {Line} */
  let line = { start: point.pos, end: null };
  let fresh = point.fresh;
  /** @type {Line | null} */
  let statement = null;
  /** @type {Token | null} */
  let lastSignificant = null;
  /** @type {{ token: Token, line: Line }[]} */
  const open = [];
  const spans = (/** @type {Line} */ l, /** @type {number} */ at) => l.end !== null && l.end < at;
  for (const t of tokens) {
    if (significant(t)) {
      if (ends(t)) {
        if (statement && spans(statement, t.start))
          statements.set(statement.start, {
            from: /** @type {number} */ (statement.end),
            to: t.start,
          });
        statement = null;
        fresh = true;
      } else if (fresh) {
        statement = line;
        fresh = false;
      }
      lastSignificant = t;
    }
    if (isOpen(t)) open.push({ token: t, line });
    else if (isClose(t)) {
      const top = open[open.length - 1];
      if (top && OPEN[/** @type {keyof typeof OPEN} */ (top.token.text)] === t.text) {
        open.pop();
        if (spans(top.line, t.start))
          groups.set(top.line.start, { from: top.token.end, to: t.start });
      }
    }
    const nl = t.text.indexOf("\n");
    if (nl < 0) continue;
    if (!others.has(line.start) && (t.type === "comment" || quoted(t)) && t.start >= line.start) {
      const quotes = quoted(t) ? quotesOf(t) : null;
      const close =
        t.type === "comment"
          ? t.text.endsWith("*/") && t.text.length > 3
            ? t.end - 2
            : t.end
          : (quotes?.end?.from ?? t.end);
      others.set(line.start, { from: t.start + nl, to: close });
    }
    line.end = t.start + nl;
    const lastNl = t.text.lastIndexOf("\n");
    line = { start: t.start + lastNl + 1, end: null };
    if (t.start > last) break;
  }
  if (
    statement &&
    lastSignificant &&
    (tokens[tokens.length - 1]?.end ?? 0) >= n &&
    spans(statement, lastSignificant.end)
  )
    statements.set(statement.start, {
      from: /** @type {number} */ (statement.end),
      to: lastSignificant.end,
    });
  /** @type {Map<number, Range>} */
  const folds = new Map();
  for (const [at, range] of [...groups, ...others, ...statements])
    if (at >= from && at < to && range.to > range.from) folds.set(at, range);
  for (const [at, range] of bodyFolds(lexed, tokens))
    if (!folds.has(at) && at >= from && at < to && range.to > range.from) folds.set(at, range);
  return folds;
}
