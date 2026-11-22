// PL/pgSQL bodies in the console editor (PG-35, ADR 0343): which dollar-quoted strings the lexer
// gave are a routine's PL/pgSQL body (sql/plpgsql/bodies.js), read from the tokens around the string
// when they hold its whole statement, else from the statement at the string; the body's own tokens
// drawn as PL/pgSQL (its keywords and SQL's, declared variables and parameters, strings, numbers,
// comments) instead of one string; and its blocks folded to their END. Each answer is kept for the
// text it was read from, so scrolling reads nothing again. Pure but for the token cache it is handed.

import { bodiesOf } from "../sql/plpgsql/bodies.js";
import { outlineOf, PLPGSQL_KEYWORDS } from "../sql/plpgsql/outline.js";
import { functionsOf, keywordsOf } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {import("./tokens.js").Lexed} Lexed
 * @typedef {import("../sql/plpgsql/bodies.js").Body} Body
 * @typedef {import("../sql/plpgsql/outline.js").Outline} Outline
 * @typedef {import("./highlight.js").Span} Span
 * @typedef {import("./pairs.js").Range} Range
 */

/** A statement longer than this is not read for a body (its string stays one). */
const MAX_STATEMENT = 512 * 1024;
const KEPT = 8;

/** @type {WeakMap<Lexed, Map<number, Body | null>>} */
const found = new WeakMap();
/** The outlines of the last bodies read, by their text and where they start. */
/** @type {Map<string, Outline>} */
const outlines = new Map();
const FUNCTIONS = new Set(functionsOf("postgresql"));
const KEYWORDS = keywordsOf("postgresql");

const ends = (/** @type {Token | undefined} */ t) => t?.type === "end" || t?.type === "delimiter";
const candidate = (/** @type {Token} */ t) => t.type === "string" && t.text.startsWith("$");

/** The body the dollar-quoted string `tokens[i]` is, or null. */
export function bodyOfToken(
  /** @type {Lexed} */ lexed,
  /** @type {Token[]} */ tokens,
  /** @type {number} */ i,
) {
  const token = /** @type {Token} */ (tokens[i]);
  if (lexed.dialect !== "postgresql" || !candidate(token)) return null;
  let cache = found.get(lexed);
  if (!cache) {
    cache = new Map();
    found.set(lexed, cache);
  }
  const known = cache.get(token.start);
  if (known !== undefined) return known;
  const source = lexed.source;
  const slice = (/** @type {number} */ a, /** @type {number} */ b) => source.sliceString(a, b);
  let first = i;
  while (first > 0 && !ends(tokens[first - 1])) first--;
  let last = i;
  while (last < tokens.length - 1 && !ends(tokens[last + 1])) last++;
  const point = lexed.pointBefore(tokens[0]?.start ?? 0);
  const whole =
    (first > 0 || (point.pos === tokens[0]?.start && point.fresh)) &&
    (last < tokens.length - 1 || (tokens[last]?.end ?? 0) >= source.length);
  let statement = whole ? tokens.slice(first, last + 1) : null;
  if (!statement) {
    const { from, to } = lexed.statementAt(token.start);
    if (to - from > MAX_STATEMENT) {
      cache.set(token.start, null);
      return null;
    }
    statement = lexed.tokens(from, to).tokens.filter((t) => t.start >= from && t.end <= to);
  }
  const body = bodiesOf(statement, slice).find((b) => b.open === token.start) ?? null;
  cache.set(token.start, body);
  return body;
}

/** The outline of a body, kept for its text. */
export function outlineOfBody(/** @type {Lexed} */ lexed, /** @type {Body} */ body) {
  const content = lexed.source.sliceString(body.from, body.to);
  const key = `${body.from}\u0000${content}`;
  let outline = outlines.get(key);
  if (outline) {
    outlines.delete(key);
  } else outline = outlineOf(content, body.from);
  outlines.set(key, outline);
  while (outlines.size > KEPT)
    outlines.delete(/** @type {string} */ (outlines.keys().next().value));
  return outline;
}

/** The names a body's words are drawn as variables for: its parameters, declarations and labels. */
export function variablesOf(/** @type {Body} */ body, /** @type {Outline} */ outline) {
  return new Set([
    ...body.params.map((p) => p.name).filter(Boolean),
    ...outline.decls.map((d) => d.name),
    ...outline.labels,
  ]);
}

/** The kind a body's token is drawn as; null for none. @returns {Span["kind"] | null} */
function kindIn(
  /** @type {Token[]} */ tokens,
  /** @type {number} */ i,
  /** @type {Set<string>} */ variables,
) {
  const t = /** @type {Token} */ (tokens[i]);
  if (t.type === "word" || t.type === "name") {
    let p = i - 1;
    while (p >= 0 && (tokens[p]?.type === "space" || tokens[p]?.type === "comment")) p--;
    const after = tokens[p]?.type === "op" && tokens[p]?.text === ".";
    const name = t.type === "word" ? t.text.toLowerCase() : t.text.slice(1, -1);
    if (!after && variables.has(name)) return "variable";
    if (t.type === "name") return "name";
    if (after) return null;
    const next = tokens[i + 1];
    if (next?.type === "op" && next.text === "(" && FUNCTIONS.has(name)) return "function";
    const upper = t.text.toUpperCase();
    return PLPGSQL_KEYWORDS.has(upper) || KEYWORDS.has(upper) ? "keyword" : null;
  }
  if (t.type === "space" || t.type === "op" || t.type === "end") return null;
  return t.type === "delimiter" ? "keyword" : t.type;
}

/**
 * The spans of `from`..`to` with every PL/pgSQL body in `tokens` drawn as its own tokens: the body
 * string's span is cut around the body, its quotes stay a string.
 * @param {Lexed} lexed @param {Token[]} tokens @param {Span[]} spans what highlight.js drew
 * @param {number} from @param {number} to
 * @returns {Span[]}
 */
export function withBodies(lexed, tokens, spans, from, to) {
  if (lexed.dialect !== "postgresql") return spans;
  /** @type {Span[]} */
  let out = spans;
  for (let i = 0; i < tokens.length; i++) {
    const token = /** @type {Token} */ (tokens[i]);
    if (token.end <= from || token.start >= to || !candidate(token)) continue;
    const body = bodyOfToken(lexed, tokens, i);
    if (!body) continue;
    const a = Math.max(from, body.from);
    const b = Math.min(to, body.to);
    if (a >= b) continue;
    const outline = outlineOfBody(lexed, body);
    const variables = variablesOf(body, outline);
    /** @type {Span[]} */
    const inner = [];
    outline.tokens.forEach((t, k) => {
      if (t.end <= a || t.start >= b) return;
      const kind = kindIn(outline.tokens, k, variables);
      if (kind) inner.push({ from: Math.max(a, t.start), to: Math.min(b, t.end), kind });
    });
    /** @type {Span[]} */
    const next = [];
    for (const s of out) {
      if (s.to <= a || s.from >= b) next.push(s);
      else {
        if (s.from < a) next.push({ ...s, to: a });
        if (s.to > b) next.push({ ...s, from: b });
      }
    }
    out = [...next, ...inner].sort((x, y) => x.from - y.from);
  }
  return out;
}

/** Where the line holding `pos` starts. */
function lineStart(/** @type {Lexed["source"]} */ source, /** @type {number} */ pos) {
  let at = pos;
  while (at > 0) {
    const from = Math.max(0, at - 4096);
    const nl = source.sliceString(from, at).lastIndexOf("\n");
    if (nl >= 0) return from + nl + 1;
    at = from;
  }
  return 0;
}

/**
 * The folds of the blocks of the bodies among `tokens`, by the line each opens on: from that line's
 * end to its END (DECLARE's to BEGIN), when that is on a later line.
 * @param {Lexed} lexed @param {Token[]} tokens
 * @returns {Map<number, Range>}
 */
export function bodyFolds(lexed, tokens) {
  /** @type {Map<number, Range>} */
  const folds = new Map();
  if (lexed.dialect !== "postgresql") return folds;
  for (let i = 0; i < tokens.length; i++) {
    const token = /** @type {Token} */ (tokens[i]);
    if (!candidate(token) || !token.text.includes("\n")) continue;
    const body = bodyOfToken(lexed, tokens, i);
    if (!body) continue;
    const content = lexed.source.sliceString(body.from, body.to);
    const fold = (/** @type {number} */ from, /** @type {number} */ to) => {
      const nl = content.indexOf("\n", from - body.from);
      if (nl < 0 || body.from + nl >= to) return;
      const at = lineStart(lexed.source, from);
      if (!folds.has(at)) folds.set(at, { from: body.from + nl, to });
    };
    for (const c of outlineOfBody(lexed, body).constructs) {
      if (c.end === null) continue;
      // A block with DECLARE folds its declarations to BEGIN, and BEGIN to its END.
      if (c.begin !== null && c.begin !== c.from) {
        fold(c.from, c.begin);
        fold(c.begin, c.end);
      } else fold(c.from, c.end);
    }
  }
  return folds;
}
