// Autocomplete from the introspected schema. The statement around the caret is read with the same
// lexer statements are cut with: after FROM, JOIN, INTO or UPDATE it offers tables, views and
// schemas; after `alias.` or `table.` that table's columns; after `schema.` its tables; elsewhere
// the columns of every table the statement names (with their aliases), functions and keywords.
// Tables whose columns are not read yet come back in `wants`, so the caller reads them and asks
// again. Inside a string or a comment nothing is offered. Pure.

import { tokenize } from "../sql/lexer.js";
import { quoteName } from "../sql/quote.js";
import { functionsOf, keywordsOf, RESERVED } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ name: string, type: string }} Named
 * @typedef {{
 *   defaultSchema: string,
 *   schemas(): string[],
 *   tables(schema: string): Named[] | undefined,
 *   columns(schema: string, table: string): Named[] | undefined,
 * }} SchemaView
 * @typedef {"column" | "alias" | "table" | "view" | "schema" | "function" | "keyword"} ItemKind
 * @typedef {{ label: string, kind: ItemKind, detail: string, insert: string }} Item
 * @typedef {{ schema: string, name: string, alias: string, start: number }} Ref
 * @typedef {{ from: number, to: number, items: Item[], wants: { schema: string, table: string }[] }} Completion
 */

const TABLE_WORDS = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE", "DESCRIBE", "TRUNCATE"]);
const FROM_ENDS = new Set([
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "SET",
  "VALUES",
  "ON",
  "USING",
  "WINDOW",
  "RETURNING",
  "OFFSET",
  "FETCH",
  "FOR",
  "SELECT",
]);
/** Kinds in the order they are offered; tables and views together. */
const RANK = { column: 0, alias: 1, table: 2, view: 2, schema: 3, function: 4, keyword: 5 };
const WORD = /[A-Za-z0-9_$\u0080-￿]/u;
const LIMIT = 100;

/**
 * @param {string} text
 * @param {number} caret
 * @param {Dialect} dialect
 * @param {SchemaView} schema
 * @returns {Completion}
 */
export function complete(text, caret, dialect, schema) {
  const tokens = tokenize(text, dialect);
  let from = caret;
  while (from > 0 && WORD.test(text[from - 1] ?? "")) from--;
  const none = { from, to: caret, items: [], wants: [] };
  const inside = tokens.find((t) => t.start < caret && caret <= t.end);
  const quoted = inside?.type === "string" || inside?.type === "comment" || inside?.type === "name";
  const after = inside && inside.type !== "comment" && caret === inside.end && closed(inside);
  if (quoted && !after) return none;
  if (/[0-9]/u.test(text[from] ?? "") && from < caret) return none;
  const prefix = text.slice(from, caret);
  const statement = statementTokens(tokens, from);
  const qualifier = qualifierBefore(statement, from, dialect);
  const before = statement.filter((t) => t.end <= (qualifier.start ?? from));
  const refs = refsOf(statement, dialect, schema.defaultSchema).filter(
    (r) => !(r.start >= (qualifier.start ?? from) && r.start <= caret),
  );
  /** @type {Item[]} */
  const items = [];
  /** @type {Completion["wants"]} */
  const wants = [];
  const columnsOf = (
    /** @type {string} */ s,
    /** @type {string} */ t,
    /** @type {string} */ by,
  ) => {
    const columns = schema.columns(s, t);
    if (!columns) {
      wants.push({ schema: s, table: t });
      return;
    }
    for (const c of columns)
      items.push({
        label: c.name,
        kind: "column",
        detail: `${c.type} · ${by}`,
        insert: ident(dialect, c.name),
      });
  };
  const tablesOf = (/** @type {string} */ s) => {
    for (const t of schema.tables(s) ?? [])
      items.push({
        label: t.name,
        kind: t.type.includes("view") ? "view" : "table",
        detail: s,
        insert: ident(dialect, t.name),
      });
  };
  const names = qualifier.names;
  if (names.length === 1) {
    const q = fold(names[0] ?? "");
    const ref = refs.find((r) => fold(r.alias) === q) ?? refs.find((r) => fold(r.name) === q);
    if (ref) columnsOf(ref.schema, ref.name, ref.alias || ref.name);
    else if (schema.schemas().some((s) => fold(s) === q))
      tablesOf(schema.schemas().find((s) => fold(s) === q) ?? "");
    else if (schema.tables(schema.defaultSchema)?.some((t) => fold(t.name) === q))
      columnsOf(schema.defaultSchema, names[0] ?? "", names[0] ?? "");
  } else if (names.length === 2) columnsOf(names[0] ?? "", names[1] ?? "", names[1] ?? "");
  else if (wantsTable(before)) {
    if (schema.defaultSchema) tablesOf(schema.defaultSchema);
    for (const s of schema.schemas())
      if (s !== schema.defaultSchema)
        items.push({ label: s, kind: "schema", detail: "schema", insert: ident(dialect, s) });
  } else {
    for (const ref of refs) {
      columnsOf(ref.schema, ref.name, ref.alias || ref.name);
      const label = ref.alias || ref.name;
      items.push({
        label,
        kind: "alias",
        detail: ref.alias ? `${ref.name}` : "table",
        insert: ident(dialect, label),
      });
    }
    for (const f of functionsOf(dialect))
      items.push({ label: f, kind: "function", detail: "function", insert: f });
    const lower = prefix !== "" && prefix === prefix.toLowerCase();
    for (const k of keywordsOf(dialect))
      items.push({
        label: k,
        kind: "keyword",
        detail: "keyword",
        insert: lower ? k.toLowerCase() : k,
      });
  }
  return { from, to: caret, items: rank(items, prefix), wants: unique(wants) };
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

/** `a.` or `a.b.` right before the word at `from`: the names, and where the chain starts. */
function qualifierBefore(
  /** @type {Token[]} */ tokens,
  /** @type {number} */ from,
  /** @type {Dialect} */ dialect,
) {
  /** @type {string[]} */
  const names = [];
  /** @type {number | undefined} */
  let start;
  let at = from;
  for (;;) {
    const dot = tokens.find((t) => t.end === at && t.type === "op" && t.text === ".");
    const name = dot && tokens.find((t) => t.end === dot.start);
    if (!dot || !name || (name.type !== "word" && name.type !== "name")) break;
    names.unshift(unquote(name, dialect));
    start = name.start;
    at = name.start;
    if (names.length === 2) break;
  }
  return { names, start };
}

/** Whether the word being typed stands where a table goes: after FROM, JOIN, INTO, ... or a comma in FROM. */
function wantsTable(/** @type {Token[]} */ before) {
  const last = before[before.length - 1];
  if (!last) return false;
  if (last.type === "word") return TABLE_WORDS.has(last.text.toUpperCase());
  if (last.type !== "op" || last.text !== ",") return false;
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const t = /** @type {Token} */ (before[i]);
    if (t.type === "op" && t.text === ")") depth++;
    else if (t.type === "op" && t.text === "(") depth--;
    else if (depth === 0 && t.type === "word") {
      const w = t.text.toUpperCase();
      if (w === "FROM") return true;
      if (FROM_ENDS.has(w)) return false;
    }
  }
  return false;
}

/**
 * The tables a statement names, with their aliases: after FROM (and its commas), JOIN, UPDATE, INTO.
 * @param {Token[]} tokens
 * @param {Dialect} dialect
 * @param {string} defaultSchema
 * @returns {Ref[]}
 */
export function refsOf(tokens, dialect, defaultSchema) {
  /** @type {Ref[]} */
  const refs = [];
  let inFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {Token} */ (tokens[i]);
    const word = t.type === "word" ? t.text.toUpperCase() : "";
    if (word === "FROM") inFrom = true;
    else if (FROM_ENDS.has(word)) inFrom = false;
    const starts = (word && TABLE_WORDS.has(word)) || (inFrom && t.type === "op" && t.text === ",");
    if (!starts) continue;
    const first = tokens[i + 1];
    if (!first || (first.type !== "word" && first.type !== "name")) continue;
    if (first.type === "word" && RESERVED.has(first.text.toUpperCase())) continue;
    let j = i + 1;
    const parts = [unquote(first, dialect)];
    if (tokens[j + 1]?.type === "op" && tokens[j + 1]?.text === "." && tokens[j + 2]) {
      parts.push(unquote(/** @type {Token} */ (tokens[j + 2]), dialect));
      j += 2;
    }
    let alias = "";
    let k = j + 1;
    if (tokens[k]?.type === "word" && tokens[k]?.text.toUpperCase() === "AS") k++;
    const a = tokens[k];
    if (
      a &&
      (a.type === "name" || (a.type === "word" && !keywordsOf(dialect).has(a.text.toUpperCase())))
    )
      alias = unquote(a, dialect);
    const [s, n] = parts.length === 2 ? parts : [defaultSchema, parts[0]];
    refs.push({ schema: s ?? "", name: n ?? "", alias, start: first.start });
  }
  return refs;
}

/** A name token as the server reads it. */
function unquote(/** @type {Token} */ token, /** @type {Dialect} */ dialect) {
  if (token.type !== "name")
    return dialect === "postgresql" ? token.text.toLowerCase() : token.text;
  const q = token.text[0];
  const inner = token.text.slice(1, -1);
  return q === "[" ? inner : inner.replaceAll(`${q}${q}`, q ?? "");
}

/** A name as it must be written: quoted unless it is a plain lower-case (PostgreSQL) word. */
export function ident(/** @type {Dialect} */ dialect, /** @type {string} */ name) {
  const plain = dialect === "postgresql" ? /^[a-z_][a-z0-9_$]*$/u : /^[A-Za-z_][A-Za-z0-9_$]*$/u;
  return plain.test(name) && !RESERVED.has(name.toUpperCase()) ? name : quoteName(dialect, name);
}

const fold = (/** @type {string} */ s) => s.toLowerCase();

/** Items that start with the prefix first, then those that hold it (from three letters); by kind, then by name. */
function rank(/** @type {Item[]} */ items, /** @type {string} */ prefix) {
  const p = prefix.toLowerCase();
  const seen = new Set();
  return items
    .map((item) => {
      const label = item.label.toLowerCase();
      const score = label.startsWith(p) ? 0 : p.length > 2 && label.includes(p) ? 1 : 2;
      return { item, score };
    })
    .filter(({ item, score }) => {
      const key = `${item.kind}\u0000${item.label}\u0000${item.detail}`;
      if (score === 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        RANK[a.item.kind] - RANK[b.item.kind] ||
        a.item.label.localeCompare(b.item.label),
    )
    .slice(0, LIMIT)
    .map(({ item }) => item);
}

/** @param {Completion["wants"]} wants */
function unique(wants) {
  const seen = new Set();
  return wants.filter((w) => {
    const key = `${w.schema}\u0000${w.table}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
