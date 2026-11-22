// What the name at the caret stands for (PG-32), read off the parse worker's resolution (sql/parse/,
// PG-05): an object of the schema (a relation, a column, a routine, a type, a schema), or a name the
// statement defines itself (a CTE, an alias, a select list's output name), with where that is
// written. A type is not bound by the resolver, so the word at the caret is looked up among the
// cached types. Pure.

import { tokenize } from "../sql/lexer.js";

/**
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {import("../sql/parse/scope.js").Source} Source
 * @typedef {{ kind: "relation", schema: string, name: string, relkind: string }
 *   | { kind: "column", schema: string, table: string, name: string }
 *   | { kind: "function", schema: string, name: string }
 *   | { kind: "type", schema: string, name: string }
 *   | { kind: "schema", name: string }
 *   | { kind: "cte", name: string, at: number }
 *   | { kind: "alias", name: string, of: Source }
 *   | { kind: "output", name: string, at: number | null }} Aim
 *   What a name stands for; `at` is where a CTE's name or an output's expression starts.
 * @typedef {{ aim: Aim, from: number, to: number, name?: Name }} Hit
 *   The aim and where the name at the caret is written (offsets in the text).
 * @typedef {import("../sql/lexer.js").Token} Token
 */

/**
 * The tokens of a text but space and comments. psql's lexer reads `::name` as `:` and a variable
 * `:name`; after `::` that is a type's name, so it is split back into `:` and the word.
 */
export function significant(/** @type {string} */ text) {
  /** @type {Token[]} */
  const out = [];
  for (const t of tokenize(text, "postgresql")) {
    if (t.type === "space" || t.type === "comment") continue;
    if (t.type === "param" && t.text.startsWith(":") && out.at(-1)?.text === ":") {
      out.push({ type: "op", text: ":", start: t.start, end: t.start + 1 });
      const word = t.text.slice(1);
      out.push({
        type: /^"/u.test(word) ? "name" : "word",
        text: word,
        start: t.start + 1,
        end: t.end,
      });
    } else out.push(t);
  }
  return out;
}

/** An identifier token's name as the server folds it; undefined for anything else. */
export function identOf(/** @type {Token | undefined} */ t) {
  if (!t) return undefined;
  if (t.type === "word") return t.text.toLowerCase();
  if (t.type === "name" && t.text.startsWith('"')) return t.text.slice(1, -1).replaceAll('""', '"');
  return undefined;
}

/** The narrowest bound or unbound name whose span holds the caret (its end included). */
export function nameAt(/** @type {Name[]} */ names, /** @type {number} */ caret) {
  /** @type {Name | undefined} */
  let best;
  for (const n of names) {
    if (n.start.offset > caret || caret > n.end.offset) continue;
    if (!best || n.end.offset - n.start.offset < best.end.offset - best.start.offset) best = n;
  }
  return best;
}

/** What a resolved name stands for, or null when it binds to nothing the person can go to. */
export function aimOf(/** @type {Name} */ n) {
  const t = n.target;
  if (!t) return null;
  if (t.kind === "relation" && t.schema)
    return /** @type {Aim} */ ({
      kind: "relation",
      schema: t.schema,
      name: t.name,
      relkind: t.relkind,
    });
  if (t.kind === "cte")
    return /** @type {Aim} */ ({ kind: "cte", name: t.name, at: t.position.offset });
  if (t.kind === "schema") return /** @type {Aim} */ ({ kind: "schema", name: t.name });
  if (t.kind === "function" && t.schema)
    return /** @type {Aim} */ ({ kind: "function", schema: t.schema, name: t.name });
  if (t.kind === "range") return /** @type {Aim} */ ({ kind: "alias", name: t.name, of: t.of });
  if (t.kind === "output")
    return /** @type {Aim} */ ({ kind: "output", name: t.name, at: t.position?.offset ?? null });
  if (t.kind === "column") {
    const of = t.of;
    if (of.kind === "relation" && of.schema)
      return /** @type {Aim} */ ({
        kind: "column",
        schema: of.schema,
        table: of.name,
        name: t.name,
      });
    if (of.kind === "cte")
      return /** @type {Aim} */ ({ kind: "cte", name: of.name, at: of.position.offset });
    if (of.kind === "subquery" && of.alias)
      return /** @type {Aim} */ ({ kind: "alias", name: of.alias, of });
  }
  return null;
}

/** The dotted name at the caret, read off the tokens: its parts and where its last part is. */
export function wordAt(/** @type {string} */ text, /** @type {number} */ caret) {
  const tokens = significant(text);
  const i = tokens.findIndex((t) => t.start <= caret && caret <= t.end && identOf(t) !== undefined);
  if (i < 0) return null;
  const last = /** @type {Token} */ (tokens[i]);
  const parts = [/** @type {string} */ (identOf(last))];
  let j = i;
  while (tokens[j - 1]?.text === "." && identOf(tokens[j - 2]) !== undefined) {
    parts.unshift(/** @type {string} */ (identOf(tokens[j - 2])));
    j -= 2;
  }
  return { parts, from: last.start, to: last.end };
}

/**
 * The aim at the caret: the resolver's name there, else a cached type by the word there.
 * @param {Name[]} names the resolution of `text`
 * @param {string} text
 * @param {number} caret
 * @param {(schema: string | undefined, name: string) => string | null} typeIn the schema holding
 *   a type of that name (the path's first when no schema is written), or null
 * @returns {Hit | null}
 */
export function aimAt(names, text, caret, typeIn) {
  const n = nameAt(names, caret);
  const aim = n ? aimOf(n) : null;
  if (n && aim) return { aim, from: n.start.offset, to: n.end.offset, name: n };
  const word = wordAt(text, caret);
  if (!word || word.parts.length > 2) return null;
  const name = /** @type {string} */ (word.parts.at(-1));
  const schema = typeIn(word.parts.length === 2 ? word.parts[0] : undefined, name);
  return schema ? { aim: { kind: "type", schema, name }, from: word.from, to: word.to } : null;
}

/** Where the word at `at` ends (a quoted name whole). */
function wordEnd(/** @type {string} */ text, /** @type {number} */ at) {
  const t = tokenize(text.slice(at), "postgresql")[0];
  return at + (t && identOf(t) !== undefined ? t.text.length : 0);
}

/**
 * Where a name the statement defines is written: a CTE's name, an alias after its FROM item (or the
 * FROM item itself when it has none), a select list's output name. Null for an object of the schema.
 * @param {string} text
 * @param {Name[]} names
 * @param {Hit} hit
 * @returns {{ from: number, to: number } | null}
 */
export function definitionOf(text, names, hit) {
  const { aim } = hit;
  if (aim.kind === "cte") return { from: aim.at, to: wordEnd(text, aim.at) };
  if (aim.kind === "output") return aim.at === null ? null : outputAt(text, aim.name, aim.at);
  if (aim.kind !== "alias") return null;
  const tokens = significant(text);
  for (const [i, t] of tokens.entries()) {
    if (identOf(t) !== aim.name || t.start === hit.from) continue;
    if (tokens[i + 1]?.text === "." || tokens[i - 1]?.text === ".") continue;
    const before = tokens[i - 1];
    const word = identOf(before);
    if (word === "as" || before?.text === ")" || (word !== undefined && !KEYWORDS.has(word)))
      return { from: t.start, to: t.end };
  }
  // No alias: the FROM item's own name is where it is defined.
  const own = names.find(
    (n) =>
      n.kind === "relation" &&
      n.name === aim.name &&
      n.statement === hit.name?.statement &&
      n.start.offset !== hit.from,
  );
  return own ? { from: own.start.offset, to: own.end.offset } : null;
}

/** Words before a name that make it no alias (`FROM t`, `JOIN t`, `ON t`, ...). */
const KEYWORDS = new Set(
  "from join on using where and or not select by update into table only lateral set returning when then else in is like".split(
    " ",
  ),
);

/** An output name in the select list that starts at `at`: after AS, or last before `,` or FROM. */
function outputAt(
  /** @type {string} */ text,
  /** @type {string} */ name,
  /** @type {number} */ at,
) {
  const tokens = significant(text.slice(at));
  let depth = 0;
  /** @type {Token | undefined} */
  let found;
  for (const t of tokens) {
    if (t.text === "(") depth++;
    else if (t.text === ")") depth--;
    if (depth < 0 || (depth === 0 && (t.text === "," || t.type === "end"))) break;
    if (depth === 0 && identOf(t) === "from") break;
    if (depth === 0 && identOf(t) === name) found = t;
  }
  return found
    ? { from: at + found.start, to: at + found.end }
    : { from: at, to: wordEnd(text, at) };
}

/** Whether a resolved name stands for the aim (an object's usage in a console). */
export function matches(/** @type {Aim} */ aim, /** @type {Name} */ n) {
  const t = n.target;
  if (!t) return false;
  if (aim.kind === "relation")
    return (
      n.kind === "relation" &&
      t.kind === "relation" &&
      t.schema === aim.schema &&
      t.name === aim.name
    );
  if (aim.kind === "column")
    return (
      t.kind === "column" &&
      t.name === aim.name &&
      t.of.kind === "relation" &&
      t.of.schema === aim.schema &&
      t.of.name === aim.table
    );
  if (aim.kind === "function")
    return t.kind === "function" && t.schema === aim.schema && t.name === aim.name;
  if (aim.kind === "schema") return t.kind === "schema" && t.name === aim.name;
  if (aim.kind === "cte")
    return (
      (t.kind === "cte" && t.position.offset === aim.at) ||
      (t.kind === "column" && t.of.kind === "cte" && t.of.position.offset === aim.at)
    );
  if (aim.kind === "alias") return t.kind === "range" && t.name === aim.name;
  return false;
}
