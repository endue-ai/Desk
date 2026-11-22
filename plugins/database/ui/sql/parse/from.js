// A query level's FROM items: relations and CTEs by name, subqueries, function calls, JOINs (their
// ON sees both sides; USING and NATURAL columns count once; an alias hides the sides behind it),
// TABLESAMPLE, XMLTABLE and JSON_TABLE. A subquery sees the levels outside; with LATERAL, and a
// function call always, it sees the items before it too. Pure.
import { expr, flat, query } from "./query.js";
import { bindFunction, bindRangeVar, renamed } from "./scope.js";
import { fieldsOf, kindOf, listOf, stringOf } from "./tree.js";

/**
 * @typedef {import("./scope.js").Context} Context
 * @typedef {import("./scope.js").Scope} Scope
 * @typedef {import("./scope.js").Entry} Entry
 * @typedef {import("./scope.js").Source} Source
 * @typedef {import("./model.js").ModelColumn} ModelColumn
 * @typedef {import("./tree.js").Node} Node
 */

/** Adds a FROM list's items to `scope`, in order. */
export function fromList(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {unknown} */ items,
) {
  for (const item of listOf(items))
    scope.entries.push(...fromItem(ctx, scope, item, scope.entries.slice()));
}

/** The columns a column definition list names. */
const columnDefs = (/** @type {unknown} */ list) =>
  listOf(list)
    .map((d) => fieldsOf(d, "ColumnDef")?.colname)
    .filter((name) => typeof name === "string")
    .map((name) => ({ name }));

/**
 * One FROM item's entries.
 * @param {Context} ctx @param {Scope} scope @param {unknown} node
 * @param {Entry[]} before the items before it, which a lateral item sees
 * @returns {Entry[]}
 */
export function fromItem(ctx, scope, node, before) {
  const kind = kindOf(node);
  const f = /** @type {Node} */ (node)?.[kind] ?? {};
  /** The level a subquery or a call in FROM is resolved inside. */
  const beside = (/** @type {boolean} */ lateral) =>
    /** @type {Scope} */ ({ ...scope, entries: lateral ? before : [], merged: new Map() });
  const alias = f.alias?.aliasname ?? null;
  if (kind === "RangeVar") {
    if (ctx.probe && f.location === ctx.probe.at) ctx.probe.hit = { scope, before };
    const bound = bindRangeVar(ctx, f, scope);
    return [
      {
        name: alias ?? f.relname ?? "",
        schema: alias ? null : bound.schema,
        source: bound.source,
        columns: renamed(bound.columns, f.alias?.colnames),
      },
    ];
  }
  if (kind === "RangeSubselect") {
    const columns = query(ctx, beside(Boolean(f.lateral)), f.subquery);
    const source = /** @type {Source} */ ({ kind: "subquery", alias });
    return [{ name: alias, schema: null, source, columns: renamed(columns, f.alias?.colnames) }];
  }
  if (kind === "RangeFunction") return [rangeFunction(ctx, beside(true), f, alias)];
  if (kind === "JoinExpr") return join(ctx, scope, f, before, alias);
  if (kind === "RangeTableSample") {
    expr(ctx, scope, [f.args, f.repeatable]);
    return fromItem(ctx, scope, f.relation, before);
  }
  if (kind === "RangeTableFunc" || kind === "JsonTable") {
    const inner = beside(true);
    /** @type {ModelColumn[]} */
    const columns = [];
    if (kind === "RangeTableFunc") {
      expr(ctx, inner, [f.docexpr, f.rowexpr, f.namespaces]);
      for (const col of listOf(f.columns)) {
        const c = fieldsOf(col, "RangeTableFuncCol") ?? {};
        expr(ctx, inner, [c.colexpr, c.coldefexpr]);
        columns.push({ name: c.colname ?? "" });
      }
    } else {
      expr(ctx, inner, [f.context_item, f.passing]);
      const todo = listOf(f.columns);
      while (todo.length > 0) {
        const c = fieldsOf(todo.shift(), "JsonTableColumn") ?? {};
        if (c.coltype === "JTC_NESTED") todo.unshift(...listOf(c.columns));
        else columns.push({ name: c.name ?? "" });
      }
    }
    const name = kind === "JsonTable" ? "json_table" : "xmltable";
    const source = /** @type {Source} */ ({ kind: "table function", name, alias });
    return [{ name: alias, schema: null, source, columns: renamed(columns, f.alias?.colnames) }];
  }
  expr(ctx, scope, node);
  return [];
}

/** Functions in FROM (ROWS FROM too): named by the alias or the one function's name. */
function rangeFunction(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ inner,
  /** @type {Node} */ f,
  /** @type {string | null} */ alias,
) {
  /** @type {Source | null} */
  let source = null;
  let fallback = "";
  /** @type {ModelColumn[] | null} */
  let defined = f.coldeflist ? columnDefs(f.coldeflist) : null;
  for (const item of listOf(f.functions)) {
    const [call, defs] = listOf(fieldsOf(item, "List")?.items);
    const fc = fieldsOf(call, "FuncCall");
    if (fc) {
      const target = bindFunction(ctx, fc);
      expr(ctx, inner, [fc.args, fc.agg_order, fc.agg_filter, fc.over]);
      fallback ||= stringOf(listOf(fc.funcname).at(-1)) ?? "";
      if (!source && target?.kind === "function") source = target;
    } else expr(ctx, inner, call);
    const listed = columnDefs(defs);
    if (listed.length) defined = [...(defined ?? []), ...listed];
  }
  if (defined && f.ordinality) defined.push({ name: "ordinality" });
  const name = alias ?? (listOf(f.functions).length === 1 ? fallback : null);
  return {
    name,
    schema: null,
    source:
      source ??
      /** @type {Source} */ ({ kind: "function", schema: null, name: fallback, routines: [] }),
    columns: renamed(defined, f.alias?.colnames),
  };
}

/** A JOIN's entries: its two sides, or one entry under its alias. */
function join(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {Node} */ f,
  /** @type {Entry[]} */ before,
  /** @type {string | null} */ alias,
) {
  const left = fromItem(ctx, scope, f.larg, before);
  const right = fromItem(ctx, scope, f.rarg, [...before, ...left]);
  const both = [...left, ...right];
  const using = listOf(f.usingClause).map((n) => stringOf(n) ?? "");
  const leftColumns = left.map(flat);
  const shared = f.isNatural
    ? leftColumns.every(Boolean) && right.map(flat).every(Boolean)
      ? leftColumns
          .flatMap((c) => c ?? [])
          .map((c) => c.name)
          .filter((n) => right.some((e) => flat(e)?.some((c) => c.name === n)))
      : []
    : using;
  /** @type {Map<string, Entry>} */
  const merged = new Map();
  for (const name of shared) {
    const holder = left.find((e) => flat(e)?.some((c) => c.name === name)) ?? left[0];
    if (holder) merged.set(name, holder);
  }
  const on = /** @type {Scope} */ ({
    ...scope,
    entries: both,
    merged: new Map([...scope.merged, ...merged]),
  });
  expr(ctx, on, f.quals);
  /** @type {Entry[]} */
  const out = [];
  const usingAlias = f.join_using_alias?.aliasname;
  if (usingAlias) {
    const source = /** @type {Source} */ ({ kind: "join", alias: usingAlias });
    out.push({ name: usingAlias, schema: null, source, columns: using.map((name) => ({ name })) });
  }
  if (alias) {
    const source = /** @type {Source} */ ({ kind: "join", alias });
    const colnames = listOf(f.alias?.colnames);
    out.push(
      colnames.length
        ? {
            name: alias,
            schema: null,
            source,
            columns: renamed(
              flat({ name: null, schema: null, source, columns: null, parts: both }),
              colnames,
            ),
          }
        : { name: alias, schema: null, source, columns: null, parts: both },
    );
    return out;
  }
  for (const [name, holder] of merged) scope.merged.set(name, holder);
  return [...both, ...out];
}
