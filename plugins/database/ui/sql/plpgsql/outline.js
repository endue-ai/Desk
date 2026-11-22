// The shape of a PL/pgSQL body read from the plugin's lexer (PG-35, ADR 0343), tolerant of a body
// still being typed: its blocks and the statements that nest (BEGIN ... END, IF ... END IF, LOOP,
// WHILE, FOR and FOREACH ... END LOOP, CASE ... END CASE), each with where it opens and where its END
// stands, and the declarations of each block (DECLARE's variables, constants, ALIAS FOR, cursors, the
// integer FOR loop's variable) with their types and where each is in reach. A SQL CASE expression's
// END is told apart from the statement's. Highlighting, folding and completion read it. Pure.

import { tokenize } from "../lexer.js";
import { nameOf } from "./bodies.js";

/**
 * @typedef {import("../lexer.js").Token} Token
 * @typedef {"variable" | "constant" | "alias" | "cursor" | "loop" | "record"} DeclKind
 * @typedef {{
 *   name: string, kind: DeclKind, type: string, rowtype: string[] | null, typeOf: string[] | null,
 *   at: number, end: number, from: number, to: number,
 * }} Decl
 *   `at`..`end` the declaration, `from`..`to` where the name is in reach; `rowtype` the relation of
 *   a `%ROWTYPE` (or `record` none), `typeOf` the names before a `%TYPE`.
 * @typedef {{ kind: "block" | "if" | "loop" | "case", from: number, begin: number | null,
 *   end: number | null, to: number | null }} Construct
 *   `from` the opening keyword (a block's DECLARE or BEGIN), `begin` a block's BEGIN (null before
 *   it), `end`..`to` its END ... words, or null.
 * @typedef {{ tokens: Token[], decls: Decl[], constructs: Construct[], labels: string[] }} Outline
 *   Every offset is the body's plus `base`.
 */

/** PL/pgSQL's own words, beyond SQL's, drawn and completed as keywords. */
export const PLPGSQL_KEYWORDS = new Set(
  (
    "ALIAS ASSERT BEGIN CLOSE CONSTANT CONTINUE CURSOR DEBUG DECLARE DIAGNOSTICS ELSIF EXCEPTION " +
    "EXECUTE EXIT FOREACH FOUND GET INFO LOG LOOP MOVE NEXT NOTICE OPEN PERFORM QUERY RAISE RECORD " +
    "RETURN REVERSE ROWTYPE SCROLL SLICE SQLSTATE STACKED STRICT TYPE WARNING WHILE ELSE ELSEIF"
  ).split(" "),
);

const significant = (/** @type {Token} */ t) => t.type !== "space" && t.type !== "comment";
const word = (/** @type {Token | undefined} */ t) =>
  t?.type === "word" ? t.text.toUpperCase() : "";
const isOp = (/** @type {Token | undefined} */ t, /** @type {string} */ text) =>
  t?.type === "op" && t.text === text;
const STOPS = new Set(["COLLATE", "NOT", "DEFAULT"]);

/** One declaration, from its name to before its `;`. @returns {Omit<Decl, "from" | "to">} */
function declOf(/** @type {Token[]} */ d, /** @type {string} */ text, /** @type {number} */ base) {
  const first = /** @type {Token} */ (d[0]);
  /** @type {DeclKind} */
  let kind = "variable";
  let j = 1;
  if (word(d[1]) === "ALIAS") kind = "alias";
  if (word(d[j]) === "CONSTANT") {
    kind = "constant";
    j++;
  }
  if (["NO", "SCROLL", "CURSOR"].includes(word(d[j]))) kind = "cursor";
  let k = j;
  while (k < d.length && !STOPS.has(word(d[k])) && !isOp(d[k], ":") && !isOp(d[k], "=")) {
    if (kind === "cursor" && (word(d[k]) === "FOR" || word(d[k]) === "IS")) break;
    k++;
  }
  const typed = d.slice(j, k);
  const type = typed.length
    ? text.slice(typed[0].start - base, (typed.at(-1)?.end ?? 0) - base).replace(/\s+/gu, " ")
    : "";
  const pct = typed.findIndex((t) => isOp(t, "%"));
  const names = (pct < 0 ? [] : typed.slice(0, pct))
    .filter((t) => t.type === "word" || t.type === "name")
    .map(nameOf);
  const suffix = pct < 0 ? "" : word(typed[pct + 1]);
  if (kind === "variable" && word(typed[0]) === "RECORD" && typed.length === 1) kind = "record";
  return {
    name: nameOf(first),
    kind,
    type,
    rowtype: suffix === "ROWTYPE" ? names : null,
    typeOf: suffix === "TYPE" ? names : null,
    at: first.start,
    end: d.at(-1)?.end ?? first.end,
  };
}

/**
 * The outline of the body text `content`, which starts at `base` in the script.
 * @param {string} content @param {number} [base]
 * @returns {Outline}
 */
export function outlineOf(content, base = 0) {
  const all = tokenize(content, "postgresql").map((t) => ({
    ...t,
    start: t.start + base,
    end: t.end + base,
  }));
  const tokens = all.filter(significant);
  const last = base + content.length;
  /** @type {Decl[]} */
  const decls = [];
  /** @type {Construct[]} */
  const constructs = [];
  /** @type {string[]} */
  const labels = [];
  /** @type {Array<{ construct: Construct | null, decls: Decl[], header?: boolean, phase?: string }>} */
  const stack = [];
  let start = true;
  let depth = 0;
  const top = () => stack[stack.length - 1];
  const push = (/** @type {Construct["kind"]} */ kind, /** @type {number} */ from, more = {}) => {
    /** @type {Construct} */
    const construct = { kind, from, begin: kind === "block" ? from : null, end: null, to: null };
    constructs.push(construct);
    stack.push({ construct, decls: [], ...more });
  };
  /** Close the nearest open construct of `kind` at the END token `t`, to `to`. */
  const close = (
    /** @type {Construct["kind"]} */ kind,
    /** @type {number} */ at,
    /** @type {number} */ to,
  ) => {
    while (stack.length) {
      const entry = /** @type {NonNullable<ReturnType<typeof top>>} */ (stack.pop());
      for (const d of entry.decls) d.to = at;
      if (entry.construct) {
        entry.construct.end = at;
        entry.construct.to = to;
        if (entry.construct.kind === kind) return;
      }
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {Token} */ (tokens[i]);
    const w = word(t);
    const here = top();
    if (here?.phase === "declare") {
      if (w === "BEGIN") {
        here.phase = "body";
        if (here.construct) here.construct.begin = t.start;
        start = true;
        continue;
      }
      let j = i;
      let paren = 0;
      while (j < tokens.length) {
        const u = tokens[j];
        if (isOp(u, "(")) paren++;
        else if (isOp(u, ")")) paren--;
        else if (paren <= 0 && (u?.type === "end" || word(u) === "BEGIN")) break;
        j++;
      }
      if (t.type === "word" || t.type === "name") {
        const decl = { ...declOf(tokens.slice(i, j), content, base), from: 0, to: last };
        decl.from = decl.end;
        decls.push(decl);
        here.decls.push(decl);
      }
      i = word(tokens[j]) === "BEGIN" ? j - 1 : j;
      continue;
    }
    if (isOp(t, "<") && isOp(tokens[i + 1], "<") && isOp(tokens[i + 3], ">")) {
      labels.push(nameOf(tokens[i + 2]));
      i += isOp(tokens[i + 4], ">") ? 4 : 3;
      continue;
    }
    if (isOp(t, "(")) depth++;
    else if (isOp(t, ")")) depth = Math.max(0, depth - 1);
    const inCase = here?.construct === null;
    if (w === "END" && inCase) {
      stack.pop();
      continue;
    }
    if (w === "END") {
      const next = word(tokens[i + 1]);
      const kind =
        next === "IF" ? "if" : next === "LOOP" ? "loop" : next === "CASE" ? "case" : "block";
      const to = kind === "block" ? t.end : (tokens[i + 1]?.end ?? t.end);
      close(kind, t.start, to);
      if (kind !== "block") i++;
      start = false;
      continue;
    }
    if (start) {
      start = false;
      if (w === "DECLARE") {
        push("block", t.start, { phase: "declare" });
        const made = top()?.construct;
        if (made) made.begin = null;
      } else if (w === "BEGIN") {
        push("block", t.start, { phase: "body" });
        start = true;
      } else if (w === "IF") push("if", t.start);
      else if (w === "CASE") push("case", t.start);
      else if (w === "LOOP") {
        push("loop", t.start);
        start = true;
      } else if (w === "WHILE" || w === "FOR" || w === "FOREACH") {
        push("loop", t.start, { header: true });
        const name = tokens[i + 1];
        const loop = tokens.findIndex((u, j) => j > i && word(u) === "LOOP");
        const range =
          loop < 0
            ? ""
            : content.slice(name ? name.end - base : 0, (tokens[loop]?.start ?? base) - base);
        if (
          w === "FOR" &&
          name &&
          /\.\./u.test(range) &&
          !/^\s*in\s+(?:select|with|execute)\b/iu.test(range)
        ) {
          const decl = {
            name: nameOf(name),
            kind: /** @type {DeclKind} */ ("loop"),
            type: "integer",
            rowtype: null,
            typeOf: null,
            at: name.start,
            end: name.end,
            from: name.end,
            to: last,
          };
          decls.push(decl);
          top()?.decls.push(decl);
        }
      } else if (w === "ELSE" || w === "EXCEPTION") start = w === "ELSE";
      else if (t.type === "end") start = true;
      continue;
    }
    if (t.type === "end" && depth === 0) start = true;
    else if (w === "CASE") stack.push({ construct: null, decls: [] });
    else if (w === "THEN" && !inCase && depth === 0) start = true;
    else if (w === "LOOP" && here?.header) {
      here.header = false;
      start = true;
    }
  }
  return { tokens: all, decls, constructs, labels };
}
