// How the server finds what a name stands for, for the resolver: a relation or a routine through the
// search path (pg_catalog first unless the path names it), a CTE through the WITH lists around a
// query, a qualifier among the FROM items of a query level and the levels around it, and a column in
// those FROM items, nearest level first. Each bound or unbound name is written down with where it
// stands in the script. Pure.
import { partsAt } from "./names.js";
import { listOf, stringOf } from "./tree.js";

/**
 * @typedef {import("./positions.js").Position} Position
 * @typedef {import("./positions.js").Positions} Positions
 * @typedef {import("./model.js").ModelIndex} ModelIndex
 * @typedef {import("./model.js").ModelColumn} ModelColumn
 * @typedef {import("./model.js").ModelRoutine} ModelRoutine
 * @typedef {import("./tree.js").Node} Node
 * @typedef {{ kind: "relation", schema: string | null, name: string, relkind: string }
 *   | { kind: "cte", name: string, position: Position }
 *   | { kind: "subquery", alias: string | null }
 *   | { kind: "function", schema: string | null, name: string, routines: ModelRoutine[] }
 *   | { kind: "table function", name: string, alias: string | null }
 *   | { kind: "join", alias: string }} Source
 *   What a FROM item reads. A relation's `relkind` is "" when the model does not hold it.
 * @typedef {Source
 *   | { kind: "schema", name: string }
 *   | { kind: "column", name: string, type?: string, of: Source }
 *   | { kind: "range", name: string, of: Source }
 *   | { kind: "output", name: string, position: Position | null }} Target
 *   `range` is a FROM item named by its alias or name: a qualifier, or a whole-row reference.
 *   `output` is a select-list name that ORDER BY or GROUP BY uses.
 * @typedef {"missing" | "unread" | "ambiguous"} Reason
 *   `unread`: the model does not hold what the name could be in, so it cannot tell.
 * @typedef {{ name: string, kind: "schema" | "relation" | "column" | "function" | "qualifier",
 *   statement: number, start: Position, end: Position, target: Target | null, reason?: Reason }} Name
 * @typedef {{ name: string | null, schema: string | null, source: Source,
 *   columns: ModelColumn[] | null, parts?: Entry[], named?: boolean }} Entry
 *   A FROM item; `columns` null when not known; an aliased join holds its sides in `parts`;
 *   `named` is reached only by its name (`excluded`, RETURNING's `old` and `new`).
 * @typedef {{ name: string, columns: ModelColumn[] | null, position: Position }} Cte
 * @typedef {{ name: string, position: Position | null }} Output
 * @typedef {{ parent: Scope | null, entries: Entry[], ctes: Map<string, Cte>,
 *   merged: Map<string, Entry>, outputs: Output[] | null }} Scope
 * @typedef {{ sql: string, positions: Positions, index: ModelIndex, path: string[],
 *   statement: number, names: Name[] }} Context
 */

/** A query level inside `parent`. */
export const scopeIn = (/** @type {Scope | null} */ parent) =>
  /** @type {Scope} */ ({ parent, entries: [], ctes: new Map(), merged: new Map(), outputs: null });

/** Schemas the explorer leaves out unless asked: the model may not hold them. */
const system = (/** @type {string} */ schema) =>
  schema === "information_schema" || schema.startsWith("pg_");

/** The search path the server walks: `$user` as the user (or nothing), pg_catalog first. */
export function effectivePath(searchPath = ["$user", "public"], user = "") {
  const path = searchPath.flatMap((s) => (s === "$user" ? (user ? [user] : []) : [s]));
  return path.includes("pg_catalog") ? path : ["pg_catalog", ...path];
}

/** Writes a name down; `span` is in offsets. */
export function emit(
  /** @type {Context} */ ctx,
  /** @type {Name["kind"]} */ kind,
  /** @type {string} */ name,
  /** @type {{ start: number, end: number }} */ span,
  /** @type {Target | null} */ target,
  /** @type {Reason | undefined} */ reason = target ? undefined : "missing",
) {
  const { positions } = ctx;
  /** @type {Name} */
  const entry = {
    name,
    kind,
    statement: ctx.statement,
    start: positions.ofOffset(span.start),
    end: positions.ofOffset(span.end),
    target,
  };
  if (!target && reason) entry.reason = reason;
  ctx.names.push(entry);
}

/** Where each of `parts` is written, the name starting at byte `location`. */
export function spansOf(
  /** @type {Context} */ ctx,
  /** @type {number | undefined} */ location,
  /** @type {string[]} */ parts,
) {
  const at = ctx.positions.at(location ?? 0).offset;
  return (
    partsAt(ctx.sql, at, parts.length) ?? parts.map((p) => ({ start: at, end: at + p.length }))
  );
}

/** A schema's binding: there, not read (a system schema the model leaves out), or missing. */
function schemaTarget(/** @type {Context} */ ctx, /** @type {string} */ schema) {
  if (ctx.index.has(schema)) return { target: { kind: "schema", name: schema } };
  return { target: null, reason: /** @type {Reason} */ (system(schema) ? "unread" : "missing") };
}

/**
 * A relation by its schema (or the path) and name. pg_catalog's relations are all named pg_*, so
 * a model without pg_catalog still tells other names apart.
 * @returns {{ source: Source | null, columns: ModelColumn[] | null, reason?: Reason }}
 */
export function findRelation(
  /** @type {Context} */ ctx,
  /** @type {string | undefined} */ schema,
  /** @type {string} */ name,
) {
  let unread = false;
  for (const at of schema ? [schema] : ctx.path) {
    const held = ctx.index.get(at);
    if (!held) {
      if (system(at) && (at !== "pg_catalog" || name.startsWith("pg_"))) unread = true;
      continue;
    }
    if (!held.relations) {
      unread = true;
      continue;
    }
    const found = held.relations.get(name);
    if (found) {
      const source = { kind: "relation", schema: at, name, relkind: found.relation.kind };
      return { source: /** @type {Source} */ (source), columns: found.relation.columns ?? null };
    }
  }
  return { source: null, columns: null, reason: unread ? "unread" : "missing" };
}

/** A routine by its schema (or the path) and name; every overload is its target. */
function findRoutine(
  /** @type {Context} */ ctx,
  /** @type {string | undefined} */ schema,
  /** @type {string} */ name,
) {
  let unread = false;
  for (const at of schema ? [schema] : ctx.path) {
    const held = ctx.index.get(at);
    if (!held?.routines) {
      if (held || system(at)) unread = true;
      continue;
    }
    const routines = held.routines.get(name);
    if (routines) return { target: { kind: "function", schema: at, name, routines } };
  }
  return { target: null, reason: /** @type {Reason} */ (unread ? "unread" : "missing") };
}

/** A function call's name; the names the grammar writes for SQL syntax (EXTRACT ...) are not. */
export function bindFunction(/** @type {Context} */ ctx, /** @type {Node} */ call) {
  if (call.funcformat === "COERCE_SQL_SYNTAX") return null;
  const parts = listOf(call.funcname).map((p) => stringOf(p) ?? "");
  const spans = spansOf(ctx, call.location, parts);
  const name = parts[parts.length - 1] ?? "";
  const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (schema !== undefined) {
    const s = schemaTarget(ctx, schema);
    emit(ctx, "schema", schema, /** @type {any} */ (spans[parts.length - 2]), s.target, s.reason);
  }
  const found = findRoutine(ctx, schema, name);
  emit(
    ctx,
    "function",
    name,
    /** @type {any} */ (spans[parts.length - 1]),
    found.target,
    found.reason,
  );
  return found.target;
}

/** A CTE visible from `scope` by name. */
export function findCte(/** @type {Scope | null} */ scope, /** @type {string} */ name) {
  for (let level = scope; level; level = level.parent) {
    const cte = level.ctes.get(name);
    if (cte) return cte;
  }
  return undefined;
}

/**
 * A relation named in a FROM list or as a statement's target, written down part by part. A CTE
 * comes first for a name without a schema when `scope` is given.
 * @param {Context} ctx
 * @param {Node} rv a RangeVar's fields
 * @param {Scope | null} scope where CTEs are looked for, or null for a statement's target
 * @returns {{ source: Source, columns: ModelColumn[] | null, schema: string | null }}
 */
export function bindRangeVar(ctx, rv, scope) {
  const name = rv.relname ?? "";
  const parts = [rv.catalogname, rv.schemaname, name].filter((p) => typeof p === "string");
  const spans = spansOf(ctx, rv.location, parts);
  const span = /** @type {{ start: number, end: number }} */ (spans[spans.length - 1]);
  const cte = !rv.schemaname && scope ? findCte(scope, name) : undefined;
  if (cte) {
    const source = /** @type {Source} */ ({ kind: "cte", name, position: cte.position });
    emit(ctx, "relation", name, span, source);
    return { source, columns: cte.columns, schema: null };
  }
  if (rv.schemaname) {
    const s = schemaTarget(ctx, rv.schemaname);
    emit(
      ctx,
      "schema",
      rv.schemaname,
      /** @type {any} */ (spans[spans.length - 2]),
      s.target,
      s.reason,
    );
  }
  const found = findRelation(ctx, rv.schemaname, name);
  emit(ctx, "relation", name, span, found.source, found.reason);
  const schema = found.source?.kind === "relation" ? found.source.schema : (rv.schemaname ?? null);
  return {
    source: found.source ?? { kind: "relation", schema, name, relkind: "" },
    columns: found.columns,
    schema,
  };
}

/** `columns` under an alias's column names: the first ones renamed, as the server does. */
export function renamed(
  /** @type {ModelColumn[] | null} */ columns,
  /** @type {unknown} */ colnames,
) {
  const names = listOf(colnames).map((n) => stringOf(n) ?? "");
  if (names.length === 0) return columns;
  if (!columns) return names.map((name) => ({ name }));
  return columns.map((c, i) => (i < names.length ? { ...c, name: names[i] ?? c.name } : c));
}
