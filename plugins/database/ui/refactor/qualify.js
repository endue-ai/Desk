// Qualify every name of a statement (PG-33): the schema before each relation and routine the
// resolver bound without one (pg_catalog's routines stay bare: they are found first anyway), and,
// in a query, the FROM item's alias (or name) before each bare column. Columns INSERT, UPDATE,
// DELETE and MERGE write cannot take a qualifier, so those statements keep their columns as written;
// so do USING lists (the resolver binds none), output names, a routine's parameters, and a column
// whose relation the statement reads twice, which is counted as one it could not tell. Pure.

import { aliasAfter, applyEdits, identOf, significant, tokenStarting, written } from "./syntax.js";

/**
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {import("../sql/parse/scope.js").Source} Source
 * @typedef {import("./syntax.js").Edit} Edit
 */

/** A FROM item's source as a key: a relation by its schema and name, a CTE by where it is. */
const keyOf = (/** @type {Source | null} */ s) => {
  if (s?.kind === "relation") return `r:${s.schema}.${s.name}`;
  if (s?.kind === "cte") return `c:${s.position.offset}`;
  return null;
};

/** The verb at the statement's top level after its WITH list. */
function verbOf(/** @type {import("../sql/lexer.js").Token[]} */ tokens) {
  let depth = 0;
  for (const t of tokens) {
    if (t.text === "(") depth++;
    else if (t.text === ")") depth--;
    const w = depth === 0 && t.type === "word" ? identOf(t) : undefined;
    if (w && ["select", "values", "table", "insert", "update", "delete", "merge"].includes(w))
      return w;
  }
  return "";
}

/**
 * The statement with every name qualified, how many places changed and how many it could not tell.
 * @param {string} text
 * @param {Name[]} names
 * @returns {{ text: string, places: number, unsure: number }}
 */
export function qualifyNames(text, names) {
  const tokens = significant(text);
  const before = (/** @type {Name} */ n) => {
    const i = tokenStarting(tokens, n.start.offset);
    return i > 0 ? tokens[i - 1]?.text : undefined;
  };
  /** @type {Edit[]} */
  const edits = [];
  /** @type {Map<string, string[]>} */
  const items = new Map();
  for (const n of names) {
    const t = n.target;
    if (n.kind === "relation" && t) {
      const key = keyOf(/** @type {Source} */ (t));
      const i = tokenStarting(tokens, n.start.offset);
      const a = i < 0 ? -1 : aliasAfter(tokens, i);
      if (key)
        items.set(key, [
          ...(items.get(key) ?? []),
          (a < 0 ? tokens[i] : tokens[a])?.text ?? n.name,
        ]);
    }
    if (before(n) === ".") continue;
    if (n.kind === "relation" && t?.kind === "relation" && t.schema)
      edits.push({ from: n.start.offset, to: n.start.offset, insert: `${written(t.schema)}.` });
    if (n.kind === "function" && t?.kind === "function" && t.schema && t.schema !== "pg_catalog")
      edits.push({ from: n.start.offset, to: n.start.offset, insert: `${written(t.schema)}.` });
  }
  let unsure = 0;
  if (["select", "values", "table"].includes(verbOf(tokens)))
    for (const n of names) {
      const t = n.target;
      if (n.kind === "column" && !t && n.reason === "ambiguous") unsure++;
      if (n.kind !== "column" || t?.kind !== "column" || before(n) === ".") continue;
      const of = t.of;
      if (of.kind === "subquery" && of.alias) {
        edits.push({ from: n.start.offset, to: n.start.offset, insert: `${written(of.alias)}.` });
        continue;
      }
      const key = keyOf(of);
      if (!key) continue;
      const held = items.get(key) ?? [];
      if (held.length === 1)
        edits.push({ from: n.start.offset, to: n.start.offset, insert: `${held[0]}.` });
      else unsure++;
    }
  return { text: applyEdits(text, edits), places: edits.length, unsure };
}
