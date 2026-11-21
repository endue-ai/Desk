// The resolver: every name of every parsed statement bound to what it stands for in the schema the
// plugin holds (model.js), honouring the search path, aliases, CTEs and subquery levels, and the
// names that bind to nothing with why. Queries go through query.js; other statements bind the
// relations and routines they name, and the columns of the one relation they are about (an index's
// expressions, a CHECK, a policy, a trigger's WHEN, a rule, a function's SQL body and its
// parameters). Names a statement creates (CREATE TABLE t, CREATE VIEW v) are not references.
// Routine bodies in quotes stay strings. Pure.
import { bindColumnRef } from "./columns.js";
import { targetEntry } from "./dml.js";
import { indexModel } from "./model.js";
import { createPositions } from "./positions.js";
import { expr, QUERIES, query } from "./query.js";
import { bindFunction, bindRangeVar, effectivePath, scopeIn } from "./scope.js";
import { fieldsOf, kindOf, listOf, stringOf, walk } from "./tree.js";

/**
 * @typedef {import("./scope.js").Name} Name
 * @typedef {import("./scope.js").Context} Context
 * @typedef {import("./scope.js").Scope} Scope
 * @typedef {import("./scope.js").Entry} Entry
 * @typedef {import("./model.js").SchemaModel} SchemaModel
 * @typedef {import("./model.js").ModelIndex} ModelIndex
 * @typedef {import("./parse.js").Parsed} Parsed
 * @typedef {import("./tree.js").Node} Node
 * @typedef {{ searchPath?: string[], user?: string, positions?: import("./positions.js").Positions }} ResolveOptions
 *   `searchPath` as the server holds it (default `"$user", public`); `user` stands for `$user`.
 * @typedef {{ names: Name[], unbound: Name[] }} Resolution
 */

/** Where a statement names what it creates: not a reference. */
const DEFINES = new Set([
  "CreateStmt.relation",
  "ViewStmt.view",
  "IntoClause.rel",
  "CreateSeqStmt.sequence",
  "CompositeTypeStmt.typevar",
]);

/**
 * @param {string} sql the script that was parsed
 * @param {Parsed} parsed
 * @param {SchemaModel | ModelIndex} model
 * @param {ResolveOptions} [options]
 * @returns {Resolution}
 */
export function resolve(sql, parsed, model, options = {}) {
  /** @type {Context} */
  const ctx = {
    sql,
    positions: options.positions ?? createPositions(sql),
    index: model instanceof Map ? model : indexModel(model),
    path: effectivePath(options.searchPath, options.user),
    statement: 0,
    names: [],
  };
  parsed.statements.forEach((statement, i) => {
    ctx.statement = i;
    if (statement.tree) resolveStatement(ctx, statement.tree);
  });
  return { names: ctx.names, unbound: ctx.names.filter((n) => !n.target) };
}

/** One statement's tree. */
function resolveStatement(/** @type {Context} */ ctx, /** @type {Node} */ node) {
  const kind = kindOf(node);
  const f = node[kind] ?? {};
  if (QUERIES.has(kind)) return void query(ctx, null, node);
  if (kind === "ExplainStmt" || kind === "DeclareCursorStmt" || kind === "PrepareStmt")
    return resolveStatement(ctx, f.query ?? {});
  /** @type {Entry | undefined} */
  let target;
  /** @type {Node} */
  let rest = f;
  /** The one relation a statement is about, bound first, and its fields without it. */
  const about = (/** @type {string} */ key) => {
    target = targetEntry(ctx, f[key]);
    rest = { ...f, [key]: undefined };
  };
  if (kind === "CreateStmt" || kind === "CreateForeignTableStmt") {
    const base = kind === "CreateStmt" ? f : (f.base ?? {});
    const rv = base.relation ?? {};
    const columns = listOf(base.tableElts)
      .map((e) => fieldsOf(e, "ColumnDef")?.colname)
      .filter((name) => typeof name === "string")
      .map((name) => ({ name }));
    const source = {
      kind: "relation",
      schema: rv.schemaname ?? null,
      name: rv.relname ?? "",
      relkind: "table",
    };
    target = /** @type {Entry} */ ({ name: rv.relname ?? "", schema: null, source, columns });
  } else if (
    ["AlterTableStmt", "IndexStmt", "CopyStmt", "CreateTrigStmt", "RuleStmt"].includes(kind)
  )
    about("relation");
  else if (kind === "CreatePolicyStmt" || kind === "AlterPolicyStmt") about("table");
  else if (kind === "CreateStatsStmt" && listOf(f.relations).length === 1) {
    target = targetEntry(ctx, fieldsOf(listOf(f.relations)[0], "RangeVar"));
    rest = { ...f, relations: undefined };
  } else if (kind === "CreateFunctionStmt") return routine(ctx, f);
  const scope = scopeIn(null);
  if (target) {
    // A trigger's WHEN and a rule read the row as OLD and NEW; the others the relation itself.
    if (kind === "CreateTrigStmt" || kind === "RuleStmt") {
      const row = { ...target, schema: null, named: true };
      scope.entries.push({ ...row, name: "old" }, { ...row, name: "new" });
    } else scope.entries.push(target);
  }
  references(ctx, target ? scope : null, { [kind]: rest });
}

/** A function's or procedure's SQL body (BEGIN ATOMIC, RETURN), its parameters in scope. */
function routine(/** @type {Context} */ ctx, /** @type {Node} */ f) {
  const name = stringOf(listOf(f.funcname).at(-1)) ?? "";
  const columns = listOf(f.parameters)
    .map((p) => fieldsOf(p, "FunctionParameter")?.name)
    .filter((n) => typeof n === "string")
    .map((n) => ({ name: n }));
  const scope = scopeIn(null);
  const source = { kind: "function", schema: null, name, routines: [] };
  scope.entries.push(/** @type {Entry} */ ({ name, schema: null, source, columns }));
  references(ctx, scope, f.sql_body);
  for (const p of listOf(f.parameters))
    references(ctx, null, fieldsOf(p, "FunctionParameter")?.defexpr);
}

/**
 * The names under a node: relations (other than those it creates), routines, queries as levels
 * inside `scope`, and columns when there is a relation they belong to.
 * @param {Context} ctx @param {Scope | null} scope @param {unknown} node
 */
function references(ctx, scope, node) {
  walk(node, (kind, fields, parent, key) => {
    if (kind === "RangeVar") {
      if (!DEFINES.has(`${parent}.${key}`)) bindRangeVar(ctx, fields, null);
      return false;
    }
    if (QUERIES.has(kind)) {
      query(ctx, scope, { [kind]: fields });
      return false;
    }
    if (kind === "SubLink") {
      expr(ctx, scope ?? scopeIn(null), { SubLink: fields });
      return false;
    }
    if (kind === "ColumnRef") {
      if (scope) bindColumnRef(ctx, scope, fields);
      return false;
    }
    if (kind === "FuncCall") bindFunction(ctx, fields);
    return true;
  });
}
