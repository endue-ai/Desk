// Queries and their expressions. A SELECT is a query level: its WITH list, its FROM items (from.js),
// then its select list, WHERE, GROUP BY, HAVING, windows and ORDER BY in that level; a subquery is a
// level inside it; a set operation's sides are levels of their own and its ORDER BY reads the left
// side's output names. A query answers its output columns, so a CTE or a subquery in FROM has them.
// Pure.
import { bindColumnRef, bindQualifier } from "./columns.js";
import { insert, merge, remove, update } from "./dml.js";
import { fromList } from "./from.js";
import { bindFunction, scopeIn } from "./scope.js";
import { fieldsOf, kindOf, listOf, stringOf, walk } from "./tree.js";

/**
 * @typedef {import("./scope.js").Context} Context
 * @typedef {import("./scope.js").Scope} Scope
 * @typedef {import("./scope.js").Output} Output
 * @typedef {import("./model.js").ModelColumn} ModelColumn
 * @typedef {import("./tree.js").Node} Node
 */

export const QUERIES = new Set([
  "SelectStmt",
  "InsertStmt",
  "UpdateStmt",
  "DeleteStmt",
  "MergeStmt",
]);

/**
 * A query node resolved as a level inside `outer`; its output columns, null when not known.
 * @param {Context} ctx @param {Scope | null} outer @param {unknown} node
 * @returns {ModelColumn[] | null}
 */
export function query(ctx, outer, node) {
  const kind = kindOf(node);
  const fields = /** @type {Node} */ (node)?.[kind];
  if (kind === "SelectStmt") return select(ctx, outer, fields);
  if (kind === "InsertStmt") return insert(ctx, outer, fields);
  if (kind === "UpdateStmt") return update(ctx, outer, fields);
  if (kind === "DeleteStmt") return remove(ctx, outer, fields);
  if (kind === "MergeStmt") return merge(ctx, outer, fields);
  expr(ctx, outer ?? scopeIn(null), node);
  return null;
}

/** Every name in an expression, in `scope`; subqueries are levels inside it. */
export function expr(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {unknown} */ node,
) {
  walk(node, (kind, fields) => {
    if (kind === "ColumnRef") {
      bindColumnRef(ctx, scope, fields);
      return false;
    }
    if (kind === "FuncCall") bindFunction(ctx, fields);
    else if (kind === "SubLink") {
      expr(ctx, scope, fields.testexpr);
      query(ctx, scope, fields.subselect);
      return false;
    } else if (QUERIES.has(kind)) {
      query(ctx, scope, { [kind]: fields });
      return false;
    } else if (kind === "MultiAssignRef" && fields.colno > 1) return false;
    return true;
  });
}

/** ORDER BY's (and DISTINCT ON's) items: a bare name is the select list's alias first. */
function sortItems(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {unknown} */ items,
  /** @type {{ outputs?: Output[] | null, fallback?: Output[] | null }} */ order,
) {
  for (const item of listOf(items)) {
    const node = fieldsOf(item, "SortBy")?.node ?? item;
    const ref = fieldsOf(node, "ColumnRef");
    if (ref && listOf(ref.fields).length === 1) bindColumnRef(ctx, scope, ref, order);
    else expr(ctx, scope, node);
  }
}

/**
 * @param {Context} ctx @param {Scope | null} outer @param {Node} s a SelectStmt's fields
 * @param {(left: ModelColumn[] | null) => void} [onLeft] told the left side's columns first
 * @returns {ModelColumn[] | null}
 */
export function select(ctx, outer, s, onLeft) {
  const scope = scopeIn(outer);
  withList(ctx, scope, s.withClause);
  if (s.op && s.op !== "SETOP_NONE") {
    const left = select(ctx, scope, s.larg ?? {});
    onLeft?.(left);
    select(ctx, scope, s.rarg ?? {});
    const named = (left ?? []).map((c) => ({ name: c.name, position: null }));
    sortItems(ctx, scope, s.sortClause, { outputs: left ? named : null });
    expr(ctx, scope, [s.limitOffset, s.limitCount]);
    return left;
  }
  if (s.valuesLists) {
    const lists = listOf(s.valuesLists);
    for (const list of lists) expr(ctx, scope, list);
    const width = listOf(fieldsOf(lists[0], "List")?.items).length;
    return Array.from({ length: width }, (_, i) => ({ name: `column${i + 1}` }));
  }
  fromList(ctx, scope, s.fromClause);
  const targets = listOf(s.targetList).map((t) => fieldsOf(t, "ResTarget") ?? {});
  for (const target of targets) expr(ctx, scope, target.val);
  /** @type {Output[]} */
  const aliases = targets
    .filter((t) => t.name)
    .map((t) => ({ name: t.name, position: ctx.positions.at(t.location ?? 0) }));
  expr(ctx, scope, s.whereClause);
  sortItems(ctx, scope, s.groupClause, { fallback: aliases });
  expr(ctx, scope, [s.havingClause, s.windowClause]);
  sortItems(ctx, scope, s.distinctClause, { outputs: aliases });
  sortItems(ctx, scope, s.sortClause, { outputs: aliases });
  expr(ctx, scope, [s.limitOffset, s.limitCount]);
  for (const clause of listOf(s.lockingClause))
    for (const lock of listOf(fieldsOf(clause, "LockingClause")?.lockedRels)) {
      const rv = fieldsOf(lock, "RangeVar");
      if (rv) bindQualifier(ctx, scope, rv.relname ?? "", rv.location);
    }
  return outputsOf(scope, targets);
}

/** A WITH list's CTEs, each visible to the ones after it (to itself too when RECURSIVE). */
export function withList(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {Node | undefined} */ w,
) {
  if (!w) return;
  for (const item of listOf(w.ctes)) {
    const cte = fieldsOf(item, "CommonTableExpr");
    if (!cte) continue;
    const names = listOf(cte.aliascolnames).map((n) => ({ name: stringOf(n) ?? "" }));
    const own = {
      name: cte.ctename,
      columns: names.length ? names : null,
      position: ctx.positions.at(cte.location ?? 0),
    };
    if (w.recursive) scope.ctes.set(own.name, own);
    const inner = scopeIn(scope);
    const body = fieldsOf(cte.ctequery, "SelectStmt");
    const columns = body
      ? select(ctx, inner, body, (left) => {
          if (!names.length) own.columns = left;
        })
      : query(ctx, inner, cte.ctequery);
    if (!names.length) own.columns = columns;
    scope.ctes.set(own.name, own);
  }
}

/** What a select list's item is called when it has no alias, as the server names it. */
function nameOf(/** @type {unknown} */ node) {
  const kind = kindOf(node);
  const f = /** @type {Node} */ (node)?.[kind];
  if (kind === "ColumnRef" || kind === "A_Indirection") {
    const last = listOf(kind === "ColumnRef" ? f.fields : f.indirection).at(-1);
    return stringOf(last) ?? "?column?";
  }
  if (kind === "FuncCall") return stringOf(listOf(f.funcname).at(-1)) ?? "?column?";
  if (kind === "TypeCast" || kind === "CollateClause") {
    const inner = nameOf(f.arg);
    return inner !== "?column?" || kind !== "TypeCast"
      ? inner
      : (stringOf(listOf(f.typeName?.names).at(-1)) ?? inner);
  }
  if (kind === "SubLink")
    return f.subLinkType === "EXISTS_SUBLINK"
      ? "exists"
      : f.subLinkType === "ARRAY_SUBLINK"
        ? "array"
        : "?column?";
  if (kind === "MinMaxExpr") return f.op === "IS_GREATEST" ? "greatest" : "least";
  const fixed = {
    CaseExpr: "case",
    A_ArrayExpr: "array",
    RowExpr: "row",
    CoalesceExpr: "coalesce",
    GroupingFunc: "grouping",
  };
  return /** @type {Record<string, string>} */ (fixed)[kind] ?? "?column?";
}

/** The output columns of a select list; a `*` takes the columns of what it reads, when known. */
export function outputsOf(/** @type {Scope} */ scope, /** @type {Node[]} */ targets) {
  /** @type {ModelColumn[]} */
  const out = [];
  for (const target of targets) {
    const ref = fieldsOf(target.val, "ColumnRef");
    const fields = listOf(ref?.fields);
    if (ref && kindOf(fields.at(-1)) === "A_Star") {
      const qualifier = stringOf(fields.at(-2));
      const from = scope.entries.filter((e) =>
        qualifier === undefined ? !e.named : e.name === qualifier,
      );
      for (const entry of from) {
        const columns = flat(entry);
        if (!columns) return null;
        out.push(...columns);
      }
      continue;
    }
    out.push({ name: target.name ?? nameOf(target.val) });
  }
  return out;
}

/** A FROM item's columns, an aliased join's from its sides. */
export function flat(/** @type {import("./scope.js").Entry} */ entry) {
  if (!entry.parts) return entry.columns;
  /** @type {ModelColumn[]} */
  const all = [];
  for (const part of entry.parts) {
    const columns = flat(part);
    if (!columns) return null;
    all.push(...columns);
  }
  return all;
}
