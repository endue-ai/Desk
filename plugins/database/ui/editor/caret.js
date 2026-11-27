// Where the caret stands in its statement, read from the plugin's lexer alone, so a statement that
// does not parse yet still says it: the word being typed and the `a.` or `a.b.` before it, and the
// place: a table, a qualified name, a star to expand, INSERT's column list, a VALUES row, UPDATE's
// SET targets, a statement's start, or an expression. Also the call the caret is inside (its
// function and argument) and the column a comparison before it names. Pure.

import { tokenize } from "../sql/lexer.js";
import { RESERVED } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {"none" | "star" | "qualified" | "table" | "insert" | "values" | "set" | "start" | "expression"} Place
 * @typedef {{ names: string[], open: number, arg: number }} Call `open` is the `(`'s offset.
 * @typedef {{ table: string[], listed: string[], group: boolean, rest: boolean }} Insert
 *   `listed`: the column list written (empty when none); `group`: a column list is there;
 *   `rest`: something follows the caret in the statement.
 * @typedef {{
 *   tokens: Token[], from: number, prefix: string, chain: number, qualifier: string[],
 *   before: Token[], place: Place, join: boolean, upper: boolean, call: Call | null,
 *   operand: string[] | null, insert: Insert | null, values: number, update: string[] | null,
 *   star: { from: number, to: number, qualifier: string[] } | null,
 * }} Caret
 *   `chain` is where the word and its qualifier start; `upper` whether the statement's keywords
 *   are written in capitals; `values` the slot of a VALUES row the caret is in.
 * @typedef {{ schema: string, name: string, alias: string, start: number }} Ref
 */

const TABLE_WORDS = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE", "DESCRIBE", "TRUNCATE"]);
const FROM_ENDS = new Set(
  (
    "WHERE GROUP ORDER HAVING LIMIT UNION EXCEPT INTERSECT SET VALUES ON USING WINDOW RETURNING " +
    "OFFSET FETCH FOR SELECT"
  ).split(" "),
);
const JOIN_SIDES = new Set(["LEFT", "RIGHT", "FULL", "INNER", "OUTER"]);
/** Words a `(` follows that are not a function's name. */
const NOT_CALLS = new Set(
  "IN VALUES EXISTS ANY ALL SOME ROW ARRAY CAST OVER FILTER WITHIN CONFLICT KEY CHECK UNIQUE AS USING ON INTO TABLE REFERENCES INDEX VARCHAR CHAR NUMERIC DECIMAL".split(
    " ",
  ),
);
const SET_ENDS = new Set(["WHERE", "FROM", "RETURNING"]);
const STAR_BEFORE = new Set(["SELECT", "DISTINCT", "ALL", "RETURNING"]);
const WORD = /[A-Za-z0-9_$\u0080-￿]/u;

const upper = (/** @type {Token | undefined} */ t) =>
  t?.type === "word" ? t.text.toUpperCase() : "";
const isOp = (/** @type {Token | undefined} */ t, /** @type {string} */ text) =>
  t?.type === "op" && t.text === text;
const isName = (/** @type {Token | undefined} */ t) => t?.type === "word" || t?.type === "name";

/** A name token as the server reads it. */
export function unquote(/** @type {Token} */ token, /** @type {Dialect} */ dialect) {
  if (token.type !== "name")
    return dialect === "postgresql" ? token.text.toLowerCase() : token.text;
  const q = token.text[0];
  const inner = token.text.slice(1, -1);
  return q === "[" ? inner : inner.replaceAll(`${q}${q}`, q ?? "");
}

/** A quoted run that ends with its quote. */
function closed(/** @type {Token} */ token) {
  const open = token.text[0];
  const close = open === "[" ? "]" : open;
  return token.text.length > 1 && token.text.endsWith(close ?? "");
}

/** The tokens of the statement `at` is in, without spaces and comments. */
function statementTokens(/** @type {Token[]} */ tokens, /** @type {number} */ at) {
  let first = 0;
  let last = tokens.length;
  tokens.forEach((t, i) => {
    if ((t.type === "end" || t.type === "delimiter") && t.end <= at) first = i + 1;
  });
  const next = tokens.findIndex((t, i) => i >= first && t.type === "end" && t.start >= at);
  if (next >= 0) last = next;
  return tokens.slice(first, last).filter((t) => t.type !== "space" && t.type !== "comment");
}

/** `a.` or `a.b.` right before `from`: the names, and where the chain starts. */
function qualifierBefore(
  /** @type {Token[]} */ tokens,
  /** @type {number} */ from,
  /** @type {Dialect} */ dialect,
) {
  /** @type {string[]} */
  const names = [];
  let start = from;
  for (;;) {
    const dot = tokens.find((t) => t.end === start && isOp(t, "."));
    const name = dot && tokens.find((t) => t.end === dot.start);
    if (!dot || !name || !isName(name)) break;
    names.unshift(unquote(name, dialect));
    start = name.start;
    if (names.length === 2) break;
  }
  return { names, start };
}

/** Whether the word stands where a table goes: after FROM, JOIN, INTO, ... or a comma in FROM. */
function wantsTable(/** @type {Token[]} */ before) {
  const last = before[before.length - 1];
  if (!last) return false;
  if (last.type === "word") return TABLE_WORDS.has(last.text.toUpperCase());
  if (!isOp(last, ",")) return false;
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const t = /** @type {Token} */ (before[i]);
    if (isOp(t, ")")) depth++;
    else if (isOp(t, "(")) depth--;
    else if (depth === 0 && t.type === "word") {
      const w = t.text.toUpperCase();
      if (w === "FROM") return true;
      if (FROM_ENDS.has(w)) return false;
    }
  }
  return false;
}

/** After a JOIN that takes a condition: not CROSS, not NATURAL. */
function afterJoin(/** @type {Token[]} */ before) {
  if (upper(before.at(-1)) !== "JOIN") return false;
  for (let i = before.length - 2; i >= 0; i--) {
    const w = upper(before[i]);
    if (JOIN_SIDES.has(w)) continue;
    return w !== "CROSS" && w !== "NATURAL";
  }
  return true;
}

/** The innermost open call before the caret: its name and the argument the caret is in. */
function callOf(/** @type {Token[]} */ before, /** @type {Dialect} */ dialect) {
  let depth = 0;
  let commas = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const t = /** @type {Token} */ (before[i]);
    if (isOp(t, ")")) depth++;
    else if (isOp(t, "(")) {
      if (depth > 0) {
        depth--;
        continue;
      }
      const name = before[i - 1];
      if (!isName(name) || NOT_CALLS.has(upper(name)) || RESERVED.has(upper(name))) return null;
      const prior = upper(before[i - 2]);
      if (prior === "INTO" || prior === "TABLE" || prior === "REFERENCES") return null;
      const names = [unquote(/** @type {Token} */ (name), dialect)];
      if (isOp(before[i - 2], ".") && isName(before[i - 3]))
        names.unshift(unquote(/** @type {Token} */ (before[i - 3]), dialect));
      return { names, open: t.start, arg: commas };
    } else if (depth === 0 && isOp(t, ",")) commas++;
  }
  return null;
}

/** A column chain before a comparison right before the word: `o.person = |`. */
function operandOf(/** @type {Token[]} */ before, /** @type {Dialect} */ dialect) {
  let i = before.length - 1;
  let ops = 0;
  while (i >= 0 && before[i]?.type === "op" && "=<>!".includes(before[i]?.text ?? "")) {
    i--;
    ops++;
  }
  if (ops === 0 || ops > 2) return null;
  /** @type {string[]} */
  const names = [];
  while (isName(before[i])) {
    names.unshift(unquote(/** @type {Token} */ (before[i]), dialect));
    if (!isOp(before[i - 1], ".")) break;
    i -= 2;
  }
  return names.length && !RESERVED.has(names[0]?.toUpperCase() ?? "") ? names : null;
}

/** The index of the first token at depth 0 with this word, from `start`. */
function wordAt(/** @type {Token[]} */ tokens, /** @type {string} */ word, start = 0) {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    if (isOp(t, "(")) depth++;
    else if (isOp(t, ")")) depth--;
    else if (depth === 0 && upper(t) === word) return i;
  }
  return -1;
}

/** A table name at `i` (one or two parts) and the index after it. */
function tableAt(/** @type {Token[]} */ tokens, /** @type {number} */ i, /** @type {Dialect} */ d) {
  if (!isName(tokens[i])) return null;
  const parts = [unquote(/** @type {Token} */ (tokens[i]), d)];
  let next = i + 1;
  if (isOp(tokens[next], ".") && isName(tokens[next + 1])) {
    parts.push(unquote(/** @type {Token} */ (tokens[next + 1]), d));
    next += 2;
  }
  return { parts, next };
}

/** INSERT's column list or VALUES row the caret is in. */
function insertAt(tokens, before, caret, dialect) {
  const insert = wordAt(tokens, "INSERT");
  const into = insert < 0 ? -1 : wordAt(tokens, "INTO", insert);
  const table = into < 0 ? null : tableAt(tokens, into + 1, dialect);
  if (!table) return null;
  let at = table.next;
  if (upper(tokens[at]) === "AS") at += 2;
  else if (
    tokens[at]?.type === "word" &&
    !["VALUES", "SELECT", "DEFAULT", "OVERRIDING"].includes(upper(tokens[at])) &&
    !isOp(tokens[at], "(")
  )
    at++;
  /** @type {string[]} */
  const listed = [];
  let group = false;
  let groupEnd = at;
  if (isOp(tokens[at], "(") && upper(tokens[at + 1]) !== "SELECT") {
    group = true;
    let depth = 0;
    for (let i = at; i < tokens.length; i++) {
      const t = /** @type {Token} */ (tokens[i]);
      if (isOp(t, "(")) depth++;
      else if (isOp(t, ")") && --depth === 0) {
        groupEnd = i;
        break;
      } else if (depth === 1 && isName(t) && t.end < caret) listed.push(unquote(t, dialect));
      groupEnd = i;
    }
  }
  const rest = tokens.some((t) => t.start >= caret);
  const inGroup =
    group &&
    (tokens[at]?.end ?? 0) <= caret &&
    !(isOp(tokens[groupEnd], ")") && (tokens[groupEnd]?.end ?? 0) <= caret);
  if (inGroup)
    return { place: "insert", insert: { table: table.parts, listed, group, rest }, values: 0 };
  const values = wordAt(tokens, "VALUES", at);
  if (values < 0 || (tokens[values]?.end ?? caret) > caret) return null;
  let depth = 0;
  let slot = 0;
  for (const t of before.filter((b) => b.start >= (tokens[values]?.end ?? 0))) {
    if (isOp(t, "(")) {
      depth++;
      if (depth === 1) slot = 0;
    } else if (isOp(t, ")")) depth--;
    else if (depth === 1 && isOp(t, ",")) slot++;
  }
  if (depth !== 1) return null;
  return { place: "values", insert: { table: table.parts, listed, group, rest }, values: slot };
}

/** UPDATE's SET targets: the table, when the caret is where a target goes. */
function setAt(/** @type {Token[]} */ tokens, /** @type {Token[]} */ before, d) {
  const update = wordAt(tokens, "UPDATE");
  if (update < 0) return null;
  let at = update + 1;
  if (upper(tokens[at]) === "ONLY") at++;
  const table = tableAt(tokens, at, d);
  const set = wordAt(tokens, "SET", update);
  if (!table || set < 0 || before.length <= set) return null;
  if (before.slice(set + 1).some((t) => SET_ENDS.has(upper(t)))) return null;
  return table.parts;
}

/**
 * @param {string} text the statement and what is around it
 * @param {number} caret
 * @param {Dialect} dialect
 * @returns {Caret | null} null inside a string, a comment or a number
 */
export function caretOf(text, caret, dialect) {
  const all = tokenize(text, dialect);
  let from = caret;
  while (from > 0 && WORD.test(text[from - 1] ?? "")) from--;
  const inside = all.find((t) => t.start < caret && caret <= t.end);
  const quoted = inside?.type === "string" || inside?.type === "comment" || inside?.type === "name";
  const after = inside && inside.type !== "comment" && caret === inside.end && closed(inside);
  if (quoted && !after) return null;
  if (/[0-9]/u.test(text[from] ?? "") && from < caret) return null;
  const tokens = statementTokens(all, from);
  const q = qualifierBefore(tokens, from, dialect);
  const before = tokens.filter((t) => t.end <= q.start);
  const keyword = tokens.find((t) => t.type === "word");
  /** @type {Caret} */
  const found = {
    tokens,
    from,
    prefix: text.slice(from, caret),
    chain: q.start,
    qualifier: q.names,
    before,
    place: "expression",
    join: false,
    upper: keyword ? keyword.text === keyword.text.toUpperCase() : true,
    call: callOf(before, dialect),
    operand: q.names.length ? null : operandOf(before, dialect),
    insert: null,
    values: 0,
    update: null,
    star: null,
  };
  const last = before.at(-1);
  const prior = before.at(-2);
  if (found.prefix === "" && isOp(last, "*")) {
    const plain = STAR_BEFORE.has(upper(prior)) || isOp(prior, ",");
    const dotted = isOp(prior, ".") ? qualifierBefore(tokens, prior?.end ?? 0, dialect) : null;
    if (plain || dotted?.names.length) {
      const start = dotted?.names.length ? dotted.start : (last?.start ?? caret);
      found.star = { from: start, to: last?.end ?? caret, qualifier: dotted?.names ?? [] };
      found.place = "star";
      return found;
    }
  }
  if (q.names.length) found.place = "qualified";
  else if (wantsTable(before)) {
    found.place = "table";
    found.join = afterJoin(before);
  } else {
    const insert = insertAt(tokens, before, caret, dialect);
    const update = insert ? null : setAt(tokens, before, dialect);
    if (insert) {
      found.place = /** @type {Place} */ (insert.place);
      found.insert = insert.insert;
      found.values = insert.values;
    } else if (update) {
      found.update = update;
      if (isOp(last, ",") || upper(last) === "SET") found.place = "set";
    } else if (before.length === 0) found.place = "start";
  }
  return found;
}

/**
 * The tables a statement names, with their aliases: after FROM (and its commas), JOIN, UPDATE, INTO.
 * @param {Token[]} tokens
 * @param {Dialect} dialect
 * @param {string} defaultSchema
 * @param {Set<string>} keywords words that end a table without being its alias
 * @returns {Ref[]}
 */
export function refsOf(tokens, dialect, defaultSchema, keywords) {
  /** @type {Ref[]} */
  const refs = [];
  let inFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {Token} */ (tokens[i]);
    const word = upper(t);
    if (word === "FROM") inFrom = true;
    else if (FROM_ENDS.has(word)) inFrom = false;
    const starts = (word && TABLE_WORDS.has(word)) || (inFrom && isOp(t, ","));
    if (!starts) continue;
    const first = tokens[i + 1];
    if (!first || !isName(first)) continue;
    if (first.type === "word" && RESERVED.has(first.text.toUpperCase())) continue;
    let j = i + 1;
    const parts = [unquote(first, dialect)];
    if (isOp(tokens[j + 1], ".") && tokens[j + 2]) {
      parts.push(unquote(/** @type {Token} */ (tokens[j + 2]), dialect));
      j += 2;
    }
    let alias = "";
    let k = j + 1;
    if (upper(tokens[k]) === "AS") k++;
    const a = tokens[k];
    if (a && (a.type === "name" || (a.type === "word" && !keywords.has(a.text.toUpperCase()))))
      alias = unquote(a, dialect);
    const [s, n] = parts.length === 2 ? parts : [defaultSchema, parts[0]];
    refs.push({ schema: s ?? "", name: n ?? "", alias, start: first.start });
  }
  return refs;
}
