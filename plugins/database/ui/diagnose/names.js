// The names of one statement that bind to nothing, as problems (ADR 0294): the resolver's unbound
// names (ui/sql/parse/resolve.js) worded as the server words its refusal and placed where the server
// points, with what was looked for and where (the search path), and a hint of the nearest name.
// What the cache cannot tell is left out: names it did not read, functions (it leaves out aggregates,
// window functions and what extensions bring), system columns, relations in a schema that holds a
// partitioned table (partitions are not read), and every name of a statement under IF EXISTS. Pure.
import { effectivePath } from "../sql/parse/scope.js";
import { walk } from "../sql/parse/tree.js";
import { pathText, searchPathOf } from "./script.js";
import { nearest } from "./text.js";

/**
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {import("../sql/parse/tree.js").Node} Node
 * @typedef {import("./script.js").State} State
 * @typedef {{ from: number, to: number, kind: "syntax" | "names" | "server", message: string }} Problem
 *   Offsets in the text that was parsed (the statement after a space).
 */

const SYSTEM_COLUMNS = new Set(["ctid", "xmin", "xmax", "cmin", "cmax", "tableoid"]);
const DROPPED = /** @type {Record<string, string>} */ ({
  OBJECT_TABLE: "table",
  OBJECT_VIEW: "view",
  OBJECT_MATVIEW: "materialized view",
  OBJECT_SEQUENCE: "sequence",
  OBJECT_FOREIGN_TABLE: "foreign table",
  OBJECT_INDEX: "index",
});

/** What the statement says about its names: FROM items, select-list names, written columns. */
function factsOf(/** @type {Node} */ tree) {
  /** @type {Array<{ name: string, relname: string, schema: string | null, aliased: boolean, byte: number }>} */
  const items = [];
  const outputs = new Set();
  /** @type {Map<number, string>} */
  const written = new Map();
  /** @type {Set<number>} */
  const inOn = new Set();
  let target = "";
  let missingOk = false;
  let nested = false;
  walk(tree, (kind, f, parent, key) => {
    if (f?.missing_ok === true) missingOk = true;
    if (kind === "RangeSubselect" || kind === "SubLink" || kind === "CommonTableExpr")
      nested = true;
    if ((kind === "InsertStmt" || kind === "UpdateStmt" || kind === "MergeStmt") && !target)
      target = f.relation?.relname ?? "";
    if (kind === "RangeVar") {
      const alias = f.alias?.aliasname;
      items.push({
        name: alias ?? f.relname ?? "",
        relname: f.relname ?? "",
        schema: f.schemaname ?? null,
        aliased: Boolean(alias),
        byte: f.location ?? 0,
      });
    } else if (kind === "RangeSubselect" || kind === "RangeFunction") {
      const alias = f.alias?.aliasname;
      if (alias) items.push({ name: alias, relname: "", schema: null, aliased: true, byte: -1 });
    } else if (kind === "ResTarget" && f.name) {
      if (parent === "SelectStmt" && key === "targetList") outputs.add(f.name);
      else if (key === "cols" || key === "targetList") written.set(f.location ?? -1, target);
    } else if (kind === "JoinExpr" && f.quals)
      walk(f.quals, (inner, g) => {
        if (inner === "ColumnRef") inOn.add(g.location ?? -1);
      });
  });
  return { items, outputs, written, inOn, missingOk, nested };
}

/** The relation a name means on the path (or in its schema), from the state's index. */
export function relationIn(
  /** @type {State} */ state,
  /** @type {string | null} */ schema,
  /** @type {string} */ name,
) {
  const path = schema ? [schema] : effectivePath(searchPathOf(state), state.user);
  for (const at of path) {
    const found = state.index?.get(at)?.relations?.get(name);
    if (found) return { schema: at, found };
  }
  return undefined;
}

/** Relations of the held schemas on `path` (or every held schema), by name. */
function relationsOn(/** @type {State} */ state, /** @type {string[] | null} */ path) {
  /** @type {Array<{ schema: string, name: string }>} */
  const out = [];
  for (const [schema, held] of state.index ?? [])
    if (!path || path.includes(schema))
      for (const name of held.relations?.keys() ?? []) out.push({ schema, name });
  return out;
}

/** A missing relation: the server's words, the path or its schema, and a hint. */
function relationMessage(
  /** @type {State} */ state,
  /** @type {string | null} */ schema,
  /** @type {string} */ name,
) {
  if (schema) {
    const near = nearest(name, relationsOn(state, [schema]), (r) => r.name);
    const hint = near ? `\nPerhaps you meant "${schema}.${near.name}".` : "";
    return `relation "${schema}.${name}" does not exist${hint}`;
  }
  const path = effectivePath(searchPathOf(state), state.user);
  const near = nearest(name, relationsOn(state, path), (r) => r.name);
  const elsewhere = relationsOn(state, null)
    .filter((r) => r.name === name && !path.includes(r.schema))
    .map((r) => `${r.schema}.${name}`)
    .sort();
  const hint = near
    ? `\nPerhaps you meant "${near.name}".`
    : elsewhere.length > 0
      ? `\nOff the search path: ${elsewhere.join(", ")}.`
      : "";
  return `relation "${name}" does not exist (${pathText(state.path)})${hint}`;
}

/** Whether nothing but space and comments stands between two names: one dotted name. */
const dotted = (
  /** @type {string} */ sql,
  /** @type {Name} */ a,
  /** @type {Name | undefined} */ b,
) =>
  b !== undefined &&
  b.statement === a.statement &&
  /^\s*\.\s*$/u.test(sql.slice(a.end.offset, b.start.offset));

/**
 * The problems of one statement's names.
 * @param {Name[]} names the resolver's names of the statement, in the order they were bound
 * @param {Node} tree
 * @param {State} state what the statements before it left
 * @param {string} sql the text that was parsed
 * @returns {Problem[]}
 */
export function nameProblems(names, tree, state, sql) {
  if (state.opaque || !state.index || !names.some((n) => !n.target && n.reason !== "unread"))
    return [];
  const facts = factsOf(tree);
  if (facts.missingOk) return [];
  /** @type {Problem[]} */
  const out = [];
  const put = (
    /** @type {{ start: { offset: number } }} */ from,
    /** @type {{ end: { offset: number } }} */ to,
    /** @type {string} */ message,
  ) => out.push({ from: from.start.offset, to: to.end.offset, kind: "names", message });
  const path = effectivePath(searchPathOf(state), state.user);
  const pathOpen = path.some((s) => state.open.has(s));
  const dropped = DROPPED[tree.DropStmt?.removeType ?? ""];
  for (let i = 0; i < names.length; i++) {
    const name = /** @type {Name} */ (names[i]);
    const before = names[i - 1];
    const after = names[i + 1];
    if (name.target || name.reason === "unread" || name.kind === "function") continue;
    if (name.kind === "schema") {
      if (dotted(sql, name, after) && after?.kind === "relation") {
        put(
          name,
          after,
          `relation "${name.name}.${after.name}" does not exist\nThere is no schema "${name.name}".`,
        );
        i++;
      } else put(name, name, `schema "${name.name}" does not exist`);
      continue;
    }
    if (name.kind === "relation") {
      const schema = before?.kind === "schema" && dotted(sql, before, name) ? before.name : null;
      if (schema ? state.open.has(schema) : pathOpen) continue;
      const message = dropped
        ? `${dropped} "${schema ? `${schema}.` : ""}${name.name}" does not exist`
        : relationMessage(state, schema, name.name);
      put(schema && before ? before : name, name, message);
      continue;
    }
    if (name.kind === "column") {
      if (SYSTEM_COLUMNS.has(name.name)) continue;
      if (name.reason === "ambiguous") {
        put(name, name, `column reference "${name.name}" is ambiguous`);
        continue;
      }
      const qualifier = before?.kind === "qualifier" && dotted(sql, before, name) ? before : null;
      if (qualifier) {
        const of = qualifier.target?.kind === "range" ? qualifier.target.of : null;
        const found =
          of?.kind === "relation" ? relationIn(state, of.schema, of.name)?.found : undefined;
        const near = nearest(name.name, found?.columns?.keys() ?? [], (c) => c);
        const hint = near
          ? `\nPerhaps you meant to reference the column "${qualifier.name}.${near}".`
          : "";
        put(qualifier, name, `column ${qualifier.name}.${name.name} does not exist${hint}`);
      } else if (facts.written.has(name.start.byte))
        put(
          name,
          name,
          `column "${name.name}" of relation "${facts.written.get(name.start.byte)}" does not exist`,
        );
      else if (facts.outputs.has(name.name))
        put(
          name,
          name,
          `column "${name.name}" does not exist\n"${name.name}" is a name the select list gives; only ORDER BY and GROUP BY can use it.`,
        );
      else {
        // Inside a subquery the nearest column may be another level's: no hint then.
        const hint = facts.nested ? "" : columnHint(state, facts.items, name.name);
        put(name, name, `column "${name.name}" does not exist${hint}`);
      }
      continue;
    }
    if (name.kind === "qualifier") put(name, name, qualifierMessage(facts, name));
  }
  return out;
}

/** The hint for a bare column: the nearest column of the statement's relations, by its item's name. */
function columnHint(
  /** @type {State} */ state,
  /** @type {ReturnType<typeof factsOf>["items"]} */ items,
  /** @type {string} */ name,
) {
  const candidates = items.flatMap((item) => {
    const found = item.relname ? relationIn(state, item.schema, item.relname)?.found : undefined;
    return [...(found?.columns?.keys() ?? [])].map((column) => ({ ref: item.name, column }));
  });
  const near = nearest(name, candidates, (c) => c.column);
  return near ? `\nPerhaps you meant to reference the column "${near.ref}.${near.column}".` : "";
}

/** A qualifier no FROM item in reach is named: an alias's table, an item it cannot see, or none. */
function qualifierMessage(
  /** @type {ReturnType<typeof factsOf>} */ facts,
  /** @type {Name} */ name,
) {
  const aliased = facts.items.find((item) => item.aliased && item.relname === name.name);
  if (aliased && !facts.items.some((item) => item.name === name.name))
    return `invalid reference to FROM-clause entry for table "${name.name}"\nPerhaps you meant to reference the table alias "${aliased.name}".`;
  const item = facts.items.find((it) => it.name === name.name);
  const missing = `missing FROM-clause entry for table "${name.name}"`;
  if (!item) return missing;
  if (item.byte >= 0 && item.byte < name.start.byte)
    return `invalid reference to FROM-clause entry for table "${name.name}"\nThere is an entry for table "${name.name}", but it cannot be referenced from this part of the query.`;
  const where = facts.inOn.has(name.start.byte) ? ": a JOIN's ON sees only its own two sides" : "";
  return `${missing}\n"${name.name}" is in FROM, but not where this part of the query can see it${where}.`;
}
