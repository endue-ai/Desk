// INSERT, UPDATE, DELETE and MERGE: the target relation (never a CTE), the columns they write, what
// they read (UPDATE's FROM, DELETE's USING, MERGE's source), ON CONFLICT with `excluded`, and
// RETURNING with PostgreSQL 18's `old` and `new`. `excluded`, `old` and `new` are reached only by
// their names. Each answers RETURNING's columns, for a CTE that holds it. Pure.
import { fromItem, fromList } from "./from.js";
import { expr, outputsOf, query, withList } from "./query.js";
import { bindRangeVar, emit, scopeIn, spansOf } from "./scope.js";
import { fieldsOf, listOf } from "./tree.js";

/**
 * @typedef {import("./scope.js").Context} Context
 * @typedef {import("./scope.js").Scope} Scope
 * @typedef {import("./scope.js").Entry} Entry
 * @typedef {import("./model.js").ModelColumn} ModelColumn
 * @typedef {import("./tree.js").Node} Node
 */

/** A statement's target relation as a FROM item under its alias. */
export function targetEntry(/** @type {Context} */ ctx, /** @type {Node | undefined} */ rv) {
  const bound = bindRangeVar(ctx, rv ?? {}, null);
  const alias = rv?.alias?.aliasname;
  return /** @type {Entry} */ ({
    name: alias ?? rv?.relname ?? "",
    schema: alias ? null : bound.schema,
    source: bound.source,
    columns: bound.columns,
  });
}

/** The same relation, reached only by `name`. */
const named = (/** @type {Entry} */ entry, /** @type {string} */ name) =>
  /** @type {Entry} */ ({ ...entry, name, schema: null, named: true });

/** Columns a statement writes (INSERT's list, SET's names), then the values, in `scope`. */
function written(
  /** @type {Context} */ ctx,
  /** @type {Entry} */ target,
  /** @type {unknown} */ list,
  /** @type {Scope} */ scope,
) {
  for (const item of listOf(list)) {
    const t = fieldsOf(item, "ResTarget");
    if (!t) continue;
    if (t.name) {
      const span = /** @type {{ start: number, end: number }} */ (
        spansOf(ctx, t.location, [t.name])[0]
      );
      if (!target.columns) emit(ctx, "column", t.name, span, null, "unread");
      else {
        const column = target.columns.find((c) => c.name === t.name);
        /** @type {import("./scope.js").Target | null} */
        const hit = column ? { kind: "column", name: t.name, of: target.source } : null;
        if (hit && column?.type) hit.type = column.type;
        emit(ctx, "column", t.name, span, hit);
      }
    }
    expr(ctx, scope, [t.indirection, t.val]);
  }
}

/** RETURNING (PostgreSQL 18: under ReturningClause, with OLD and NEW renamed by its options). */
function returning(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {Entry} */ target,
  /** @type {Node} */ s,
) {
  const clause = s.returningClause;
  const items = clause ? clause.exprs : s.returningList;
  if (!items) return null;
  let oldName = "old";
  let newName = "new";
  for (const option of listOf(clause?.options)) {
    const o = fieldsOf(option, "ReturningOption") ?? {};
    if (o.option === "RETURNING_OPTION_OLD") oldName = o.value ?? oldName;
    if (o.option === "RETURNING_OPTION_NEW") newName = o.value ?? newName;
  }
  scope.entries.push(named(target, oldName), named(target, newName));
  const targets = listOf(items).map((t) => fieldsOf(t, "ResTarget") ?? {});
  for (const t of targets) expr(ctx, scope, t.val);
  return outputsOf(scope, targets);
}

/** @param {Context} ctx @param {Scope | null} outer @param {Node} s */
export function insert(ctx, outer, s) {
  const scope = scopeIn(outer);
  withList(ctx, scope, s.withClause);
  const target = targetEntry(ctx, s.relation);
  written(ctx, target, s.cols, scope);
  query(ctx, scope, s.selectStmt);
  const conflict = s.onConflictClause;
  if (conflict) {
    const own = /** @type {Scope} */ ({ ...scopeIn(scope), entries: [target] });
    expr(ctx, own, [conflict.infer?.indexElems, conflict.infer?.whereClause]);
    own.entries.push(named(target, "excluded"));
    written(ctx, target, conflict.targetList, own);
    expr(ctx, own, conflict.whereClause);
  }
  scope.entries.push(target);
  return returning(ctx, scope, target, s);
}

/** @param {Context} ctx @param {Scope | null} outer @param {Node} s */
export function update(ctx, outer, s) {
  const scope = scopeIn(outer);
  withList(ctx, scope, s.withClause);
  const target = targetEntry(ctx, s.relation);
  scope.entries.push(target);
  fromList(ctx, scope, s.fromClause);
  written(ctx, target, s.targetList, scope);
  expr(ctx, scope, s.whereClause);
  return returning(ctx, scope, target, s);
}

/** DELETE (`delete` is a word JavaScript keeps). @param {Context} ctx @param {Scope | null} outer @param {Node} s */
export function remove(ctx, outer, s) {
  const scope = scopeIn(outer);
  withList(ctx, scope, s.withClause);
  const target = targetEntry(ctx, s.relation);
  scope.entries.push(target);
  fromList(ctx, scope, s.usingClause);
  expr(ctx, scope, s.whereClause);
  return returning(ctx, scope, target, s);
}

/** @param {Context} ctx @param {Scope | null} outer @param {Node} s */
export function merge(ctx, outer, s) {
  const scope = scopeIn(outer);
  withList(ctx, scope, s.withClause);
  const target = targetEntry(ctx, s.relation);
  const source = fromItem(ctx, scope, s.sourceRelation, []);
  scope.entries.push(target, ...source);
  expr(ctx, scope, s.joinCondition);
  for (const clause of listOf(s.mergeWhenClauses)) {
    const w = fieldsOf(clause, "MergeWhenClause") ?? {};
    expr(ctx, scope, w.condition);
    written(ctx, target, w.targetList, scope);
    expr(ctx, scope, w.values);
  }
  return returning(ctx, scope, target, s);
}
