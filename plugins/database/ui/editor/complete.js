// Autocomplete from the schema, by where the caret stands (caret.js): after FROM, JOIN, INTO or
// UPDATE the tables a foreign key links first with their ON condition (joins.js), the CTEs, the tables
// and views of the search path and the schemas; after `alias.` or `table.` that FROM item's columns;
// after `schema.` its tables, types and functions; `*` written out on request; INSERT's column list
// and VALUES rows (lists.js); UPDATE's SET targets; elsewhere the columns of every FROM item in reach,
// nearest level first, the FROM items' names, types, functions and keywords. Candidates show their
// type and comment and are ranked by rank.js. On the page the FROM items are read from the tokens; in
// the parse worker `options.scope` answers them from the resolver (statement.js), CTEs, subqueries
// and set-returning functions with them. Tables whose columns are not read yet come back in `wants`,
// so the caller reads them and asks again. Inside a string or a comment nothing is offered. Pure.

import { quoteName } from "../sql/quote.js";
import { builtinsOf } from "./builtins.js";
import { caretOf, refsOf } from "./caret.js";
import { joinItems } from "./joins.js";
import { insertItems, rowItems, starItems } from "./lists.js";
import { keyOf, rank } from "./rank.js";
import { expectedArg, signatureOf } from "./signatures.js";
import { snippetItems } from "./snippets.js";
import { functionsOf, keywordsOf, PG_RESERVED, RESERVED } from "./words.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./rank.js").Item} Item
 * @typedef {import("./rank.js").Picks} Picks
 * @typedef {import("./joins.js").Column} Column
 * @typedef {import("./joins.js").Entry} Entry
 * @typedef {import("./caret.js").Caret} Caret
 * @typedef {import("./signatures.js").Signature} Signature
 * @typedef {{ name: string, type: string, comment?: string }} Named
 * @typedef {{
 *   defaultSchema: string,
 *   schemas(): string[],
 *   tables(schema: string): Named[] | undefined,
 *   columns(schema: string, table: string): Column[] | undefined,
 *   types?(schema: string): Named[] | undefined,
 * } & import("./joins.js").JoinView & import("./signatures.js").RoutineView} SchemaView
 *   `types` are a schema's own (enums, domains ...); `path` the schemas an unqualified name is
 *   looked for in (the default schema alone when absent).
 * @typedef {{ levels: Entry[][], ctes: Entry[], before: Entry[] | null }} Hit
 *   What is in scope at the caret: the FROM items of each query level, nearest first, the CTEs in
 *   sight, and in a FROM list the items before the caret's (what a JOIN may join to).
 * @typedef {(caret: Caret & { text: string, caret: number }) => Hit | null} ScopeAt
 * @typedef {{ from: number, to: number, items: Item[], wants: { schema: string, table: string }[],
 *   place: "statement" | "expression" | "none", signature?: Signature | null }} Completion
 *   `place` says which snippets fit there.
 */

/** A name as it must be written: quoted unless it reads back unquoted as the same name. */
export function ident(/** @type {Dialect} */ dialect, /** @type {string} */ name) {
  if (dialect === "postgresql")
    return /^[a-z_][a-z0-9_$]*$/u.test(name) && !PG_RESERVED.has(name)
      ? name
      : quoteName(dialect, name);
  return /^[A-Za-z_][A-Za-z0-9_$]*$/u.test(name) && !RESERVED.has(name.toUpperCase())
    ? name
    : quoteName(dialect, name);
}

/**
 * @param {string} text
 * @param {number} caret
 * @param {Dialect} dialect
 * @param {SchemaView} schema
 * @param {{ picks?: Picks, scope?: ScopeAt, want?: "items" | "signature" | "star",
 *   snippets?: import("./snippets.js").Snippet[], locals?: import("./plpgsql-complete.js").Locals }} [options]
 *   `snippets` are offered where they fit; `locals` a PL/pgSQL body's variables and parameters, offered
 *   in expressions and where a statement starts, a record's fields after its name and a dot
 * @returns {Completion}
 */
export function complete(text, caret, dialect, schema, options = {}) {
  const c = caretOf(text, caret, dialect);
  /** @type {Completion} */
  const none = { from: c?.from ?? caret, to: caret, items: [], wants: [], place: "none" };
  if (!c) return options.want === "signature" ? { ...none, signature: null } : none;
  const signature = signatureOf(c.call, schema, dialect);
  if (options.want === "signature") return { ...none, signature };
  if (options.want === "star" && c.place !== "star") return none;
  const name = (/** @type {string} */ n) => ident(dialect, n);
  const path = schema.path ?? [schema.defaultSchema];
  const home = (/** @type {string} */ table) =>
    path.find((s) => schema.tables(s)?.some((t) => t.name === table)) ?? schema.defaultSchema;
  /** @type {Completion["wants"]} */
  const wants = [];
  const columnsOf = (/** @type {string} */ s, /** @type {string} */ t) => {
    const found = schema.columns(s, t);
    if (!found) wants.push({ schema: s, table: t });
    return found ?? null;
  };
  /** @type {Hit | null | undefined} */
  let hit;
  const scope = () => {
    if (hit === undefined) hit = options.scope?.({ ...c, text, caret }) ?? null;
    return hit;
  };
  /** The FROM items read from the tokens, when the resolver has none. @returns {Entry[]} */
  const fromTokens = () =>
    refsOf(c.tokens, dialect, "", keywordsOf(dialect))
      .filter((r) => !(r.start >= c.chain && r.start <= caret))
      .map((r) => {
        const s = r.schema || home(r.name);
        return {
          name: r.alias || r.name,
          relation: { schema: s, name: r.name },
          columns: columnsOf(s, r.name),
        };
      });
  const levels = () => scope()?.levels ?? [fromTokens()];

  /** @type {Item[]} */
  const items = [];
  const columnItems = (/** @type {Entry} */ entry, /** @type {number} */ level) => {
    for (const col of entry.columns ?? []) {
      const type = col.type ?? "";
      items.push({
        label: col.name,
        kind: "column",
        detail: type ? `${type} · ${entry.name}` : entry.name,
        insert: name(col.name),
        ...(col.comment ? { info: col.comment } : {}),
        ...(type ? { type } : {}),
        scope: 1 + Math.min(level, 1),
        key: keyOf("column", col.name),
      });
    }
  };
  const tablesOf = (/** @type {string} */ s) => {
    for (const t of schema.tables(s) ?? []) {
      const comment = t.comment || schema.comment?.(s, t.name) || "";
      items.push({
        label: t.name,
        kind: t.type.includes("view") ? "view" : "table",
        detail: `${t.type} · ${s}`,
        insert: name(t.name),
        ...(comment ? { info: comment } : {}),
        key: keyOf("table", t.name),
      });
    }
  };
  const typesOf = (/** @type {string} */ s) => {
    for (const t of schema.types?.(s) ?? [])
      items.push({
        label: t.name,
        kind: "type",
        detail: `${t.type} · ${s}`,
        insert: name(t.name),
        key: keyOf("type", t.name),
      });
  };
  const routinesOf = (/** @type {string} */ s) => {
    for (const r of schema.routines?.(s) ?? [])
      items.push({
        label: r.name,
        kind: "function",
        detail: `(${r.args})${r.result ? ` → ${r.result}` : ""}`,
        insert: name(r.name),
        ...(r.comment ? { info: r.comment } : {}),
        ...(r.result ? { type: r.result } : {}),
        key: keyOf("function", r.name),
      });
  };
  const words = (/** @type {boolean} */ functions) => {
    if (functions) {
      for (const s of path) routinesOf(s);
      for (const f of functionsOf(dialect)) {
        const first = builtinsOf(dialect, f)[0];
        items.push({
          label: f,
          kind: "function",
          detail: first ? `(${first.args}) → ${first.result}` : "function",
          insert: f,
          ...(first ? { type: first.result } : {}),
          key: keyOf("function", f),
        });
      }
    }
    const lower = c.prefix !== "" && c.prefix === c.prefix.toLowerCase();
    for (const k of keywordsOf(dialect))
      items.push({
        label: k,
        kind: "keyword",
        detail: "keyword",
        insert: lower ? k.toLowerCase() : k,
        key: keyOf("keyword", k),
      });
  };
  const all = () => levels().flat();
  /** A column's type, by its name or its FROM item and name, nearest level first. */
  const typeOf = (/** @type {string[] | null} */ names) => {
    if (!names?.length) return "";
    const col = names.at(-1);
    const by = names.length > 1 ? names.at(-2) : undefined;
    for (const level of levels())
      for (const e of level)
        if (!by || e.name === by) {
          const found = e.columns?.find((x) => x.name === col);
          if (found) return found.type ?? "";
        }
    return "";
  };
  const target = (/** @type {string[]} */ parts) => {
    const [s, t] = parts.length === 2 ? parts : [home(parts[0] ?? ""), parts[0] ?? ""];
    return columnsOf(s ?? "", t ?? "") ?? [];
  };

  let place = /** @type {Completion["place"]} */ ("none");
  let expected = "";
  if (c.place === "star" && c.star) {
    const star = c.star;
    const at = levels()[0] ?? [];
    const read = star.qualifier.length ? at.filter((e) => e.name === star.qualifier.at(-1)) : at;
    items.push(...starItems(read, star, name));
  } else if (options.want === "star") return none;
  else if (c.place === "qualified") {
    const names = c.qualifier;
    const q = names[names.length - 1] ?? "";
    const record = names.length === 1 ? options.locals?.records.get(q) : undefined;
    const entry = names.length === 1 && !record ? all().find((e) => e.name === q) : undefined;
    const named = schema.schemas().find((s) => s === q || s.toLowerCase() === q);
    if (record) columnItems({ name: q, columns: record }, 0);
    else if (entry) columnItems(entry, 0);
    else if (names.length === 2) columnItems({ name: q, columns: columnsOf(names[0] ?? "", q) }, 0);
    else if (named !== undefined) {
      tablesOf(named);
      typesOf(named);
      routinesOf(named);
    } else if (schema.tables(home(q))?.some((t) => t.name === q))
      columnItems({ name: q, columns: columnsOf(home(q), q) }, 0);
  } else if (c.place === "table") {
    const hits = scope();
    if (c.join) items.push(...joinItems(hits?.before ?? fromTokens(), schema, name, c.upper));
    for (const cte of hits?.ctes ?? [])
      items.push({
        label: cte.name,
        kind: "cte",
        detail: "WITH",
        insert: name(cte.name),
        key: keyOf("cte", cte.name),
      });
    const shown = new Set();
    for (const s of path) {
      if (shown.has(s) || !schema.tables(s)) continue;
      shown.add(s);
      tablesOf(s);
    }
    for (const s of schema.schemas())
      if (!shown.has(s))
        items.push({
          label: s,
          kind: "schema",
          detail: "schema",
          insert: name(s),
          key: keyOf("schema", s),
        });
  } else if (c.place === "insert" && c.insert) {
    const columns = target(c.insert.table);
    if (c.insert.listed.length === 0)
      items.push(...insertItems(columns, name, { upper: c.upper, rest: c.insert.rest }));
    const listed = new Set(c.insert.listed);
    columnItems(
      {
        name: c.insert.table.at(-1) ?? "",
        columns: columns.filter((col) => !listed.has(col.name)),
      },
      0,
    );
  } else if (c.place === "values" && c.insert) {
    const columns = target(c.insert.table);
    const listed = c.insert.listed.length
      ? c.insert.listed.map((n) => columns.find((col) => col.name === n) ?? { name: n })
      : columns;
    const fresh = c.before.at(-1)?.type === "op" && c.before.at(-1)?.text === "(";
    if (c.values === 0 && fresh) items.push(...rowItems(listed, c.insert.rest));
    expected = listed[c.values]?.type ?? "";
    words(true);
    items.push(...(options.locals?.items ?? []));
    place = "expression";
  } else if (c.place === "set" && c.update) {
    columnItems({ name: c.update.at(-1) ?? "", columns: target(c.update) }, 0);
  } else if (c.place === "start") {
    // In a PL/pgSQL body, its statements' words in place of every keyword.
    if (!options.locals) words(false);
    else {
      items.push(...options.locals.items);
      for (const k of options.locals.keywords)
        items.push({
          label: k,
          kind: "keyword",
          detail: "PL/pgSQL",
          insert: c.prefix && c.prefix === c.prefix.toLowerCase() ? k.toLowerCase() : k,
          key: keyOf("keyword", k),
        });
    }
    place = "statement";
  } else {
    levels().forEach((level, depth) => {
      for (const entry of level) columnItems(entry, depth);
    });
    for (const entry of levels()[0] ?? [])
      items.push({
        label: entry.name,
        kind: "alias",
        detail:
          entry.relation && entry.relation.name !== entry.name ? entry.relation.name : "table",
        insert: name(entry.name),
        key: keyOf("alias", entry.name),
      });
    typesOf(schema.defaultSchema);
    words(true);
    items.push(...(options.locals?.items ?? []));
    place = "expression";
    expected = typeOf(c.operand) || expectedArg(signature);
  }
  items.push(...snippetItems(options.snippets ?? [], place));
  return {
    from: c.from,
    to: caret,
    items: rank(items, c.prefix, { ...(options.picks ? { picks: options.picks } : {}), expected }),
    wants: unique(wants),
    place,
  };
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
