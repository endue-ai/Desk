// Where PL/pgSQL is written in a PostgreSQL script (PG-35, ADR 0343): the dollar-quoted body of
// CREATE [OR REPLACE] FUNCTION or PROCEDURE with LANGUAGE plpgsql (before or after AS), and of DO
// (plpgsql unless its LANGUAGE says otherwise), with the routine's parameters. A body in another
// language, a BEGIN ATOMIC body and a single-quoted body are not PL/pgSQL here and stay plain text.
// Read from the plugin's lexer alone, so a statement that does not parse yet still says it. Pure.

import { tokenize } from "../lexer.js";

/**
 * @typedef {import("../lexer.js").Token} Token
 * @typedef {{ name: string, mode: string, type: string, at: number }} Param
 *   `name` as the server folds it ("" when the parameter has none), `mode` IN, OUT, INOUT or
 *   VARIADIC, `at` where its name (or its type) starts.
 * @typedef {{
 *   kind: "function" | "procedure" | "do", open: number, close: number, from: number, to: number,
 *   tag: string, closed: boolean, params: Param[], returns: string, statement: number,
 * }} Body
 *   `open`..`close` the dollar-quoted string, `from`..`to` the text inside its quotes; `statement`
 *   where the statement starts. Offsets in the text the tokens came from.
 * @typedef {(from: number, to: number) => string} Slice
 */

const MODES = new Set(["IN", "OUT", "INOUT", "VARIADIC"]);
/** Type names of more than one word: their first word is never a parameter's name. */
const TYPE_STARTS = new Set(["DOUBLE", "CHARACTER", "BIT", "NATIONAL", "TIME", "TIMESTAMP"]);
const TAG = /^\$[^$]*\$/u;

const significant = (/** @type {Token} */ t) => t.type !== "space" && t.type !== "comment";
const word = (/** @type {Token | undefined} */ t) =>
  t?.type === "word" ? t.text.toUpperCase() : "";
const isOp = (/** @type {Token | undefined} */ t, /** @type {string} */ text) =>
  t?.type === "op" && t.text === text;

/** A name or a string as the server reads it, in lower case for an unquoted one. */
export function nameOf(/** @type {Token | undefined} */ t) {
  if (!t) return "";
  if (t.type === "word") return t.text.toLowerCase();
  if (t.type === "name") return t.text.slice(1, -1).replaceAll('""', '"');
  if (t.type === "string" && t.text.startsWith("'"))
    return t.text.slice(1, -1).replaceAll("''", "'");
  return t.text.toLowerCase();
}

/** The index of the `)` that closes the `(` at `open`, or the end. */
function closing(/** @type {Token[]} */ tokens, /** @type {number} */ open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (isOp(tokens[i], "(")) depth++;
    else if (isOp(tokens[i], ")") && --depth === 0) return i;
  }
  return tokens.length;
}

/** The parameters between a routine's parentheses. */
function paramsOf(/** @type {Token[]} */ tokens, /** @type {Slice} */ slice) {
  /** @type {Token[][]} */
  const parts = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (isOp(t, "(")) depth++;
    else if (isOp(t, ")")) depth--;
    if (depth === 0 && isOp(t, ",")) parts.push([]);
    else parts[parts.length - 1]?.push(t);
  }
  /** @type {Param[]} */
  const params = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    let i = 0;
    let mode = "IN";
    if (MODES.has(word(part[0])) && part.length > 1) mode = word(part[i++]);
    const stop = part.findIndex((t, j) => j >= i && (word(t) === "DEFAULT" || isOp(t, "=")));
    const head = part.slice(i, stop < 0 ? part.length : stop);
    const first = head[0];
    if (!first) continue;
    const named =
      head.length > 1 &&
      (first.type === "name" || !TYPE_STARTS.has(word(first))) &&
      !isOp(head[1], ".") &&
      !isOp(head[1], "(") &&
      !isOp(head[1], "%") &&
      !isOp(head[1], "[");
    const typed = named ? head.slice(1) : head;
    const from = typed[0]?.start ?? first.start;
    const to = typed.at(-1)?.end ?? first.end;
    params.push({
      name: named ? nameOf(first) : "",
      mode,
      type: slice(from, to).replace(/\s+/gu, " "),
      at: first.start,
    });
  }
  return params;
}

/** The body of one statement's significant tokens, if it is PL/pgSQL. @returns {Body | null} */
function bodyOf(/** @type {Token[]} */ tokens, /** @type {Slice} */ slice) {
  let i = 0;
  const first = word(tokens[0]);
  /** @type {Body["kind"]} */
  let kind;
  let language = "";
  /** @type {Token | undefined} */
  let body;
  /** @type {Param[]} */
  let params = [];
  let returns = "";
  if (first === "DO") {
    kind = "do";
    language = "plpgsql";
    for (i = 1; i < tokens.length; i++) {
      const t = /** @type {Token} */ (tokens[i]);
      if (word(t) === "LANGUAGE") language = nameOf(tokens[++i]);
      else if (t.type === "string" && !body) body = t;
    }
  } else if (first === "CREATE") {
    i = 1;
    if (word(tokens[1]) === "OR" && word(tokens[2]) === "REPLACE") i = 3;
    const what = word(tokens[i]);
    if (what !== "FUNCTION" && what !== "PROCEDURE") return null;
    kind = what === "FUNCTION" ? "function" : "procedure";
    const open = tokens.findIndex((t, j) => j > i && isOp(t, "("));
    if (open < 0) return null;
    const close = closing(tokens, open);
    params = paramsOf(tokens.slice(open + 1, close), slice);
    for (i = close + 1; i < tokens.length; i++) {
      const t = /** @type {Token} */ (tokens[i]);
      const w = word(t);
      if (w === "LANGUAGE") language = nameOf(tokens[++i]);
      else if (w === "RETURNS") {
        const from = tokens[i + 1];
        let j = i + 1;
        const ends = new Set([
          "LANGUAGE",
          "AS",
          "IMMUTABLE",
          "STABLE",
          "VOLATILE",
          "STRICT",
          "SECURITY",
          "COST",
          "ROWS",
          "SET",
          "PARALLEL",
          "LEAKPROOF",
          "WINDOW",
          "CALLED",
          "BEGIN",
          "SUPPORT",
          "TRANSFORM",
          "EXTERNAL",
          "RETURN",
        ]);
        while (j < tokens.length && !(ends.has(word(tokens[j])) && !isOp(tokens[j - 1], "("))) {
          if (isOp(tokens[j], "(")) j = closing(tokens, j);
          j++;
        }
        const last = tokens[j - 1];
        if (from && last) returns = slice(from.start, last.end).replace(/\s+/gu, " ");
        i = j - 1;
      } else if (w === "AS" && tokens[i + 1]?.type === "string" && !body) body = tokens[++i];
    }
  } else return null;
  if (language !== "plpgsql" || !body || !body.text.startsWith("$")) return null;
  const tag = TAG.exec(body.text)?.[0] ?? "$$";
  const closed = body.text.length >= tag.length * 2 && body.text.endsWith(tag);
  return {
    kind,
    open: body.start,
    close: body.end,
    from: body.start + tag.length,
    to: closed ? body.end - tag.length : body.end,
    tag,
    closed,
    params,
    returns,
    statement: tokens[0]?.start ?? 0,
  };
}

/**
 * The PL/pgSQL bodies among the tokens of a PostgreSQL text, in order.
 * @param {Token[]} tokens @param {Slice} slice the text the tokens came from, by offsets
 * @returns {Body[]}
 */
export function bodiesOf(tokens, slice) {
  /** @type {Body[]} */
  const found = [];
  /** @type {Token[]} */
  let statement = [];
  const flush = () => {
    const body = statement.length ? bodyOf(statement, slice) : null;
    if (body) found.push(body);
    statement = [];
  };
  for (const t of tokens) {
    if (t.type === "end") flush();
    else if (significant(t)) statement.push(t);
  }
  flush();
  return found;
}

/** The PL/pgSQL bodies of a PostgreSQL text. */
export const bodiesIn = (/** @type {string} */ text) =>
  bodiesOf(tokenize(text, "postgresql"), (from, to) => text.slice(from, to));

/** The PL/pgSQL body whose inside holds `offset` (its quotes' edges included), or null. */
export function bodyAt(/** @type {string} */ text, /** @type {number} */ offset) {
  return bodiesIn(text).find((b) => b.from <= offset && offset <= b.to) ?? null;
}
