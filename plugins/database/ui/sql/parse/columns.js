// Column references: `c`, `t.c`, `s.t.c`, `t.*`, bound as the server binds them. A bare name is a
// column of exactly one FROM item at the nearest query level that has it (a USING column of a join
// counts once), else a whole FROM item by its name, else the levels outside. A qualified name finds
// its FROM item first. Ambiguity, a missing item and a column a FROM item does not have are each
// written down unbound. Pure.
import { emit, spansOf } from "./scope.js";
import { kindOf, listOf, stringOf } from "./tree.js";

/**
 * @typedef {import("./scope.js").Context} Context
 * @typedef {import("./scope.js").Scope} Scope
 * @typedef {import("./scope.js").Entry} Entry
 * @typedef {import("./scope.js").Target} Target
 * @typedef {import("./scope.js").Reason} Reason
 * @typedef {import("./tree.js").Node} Node
 */

/** A column of one FROM item: found (with what it is read from), unknown, or not there. */
function columnIn(/** @type {Entry} */ entry, /** @type {string} */ name) {
  if (entry.parts) {
    let unknown = false;
    for (const part of entry.parts) {
      const hit = columnIn(part, name);
      if (hit === "unknown") unknown = true;
      else if (hit) return hit;
    }
    return unknown ? "unknown" : null;
  }
  if (!entry.columns) return "unknown";
  const column = entry.columns.find((c) => c.name === name);
  if (!column) return null;
  /** @type {Target} */
  const target = { kind: "column", name, of: entry.source };
  if (column.type) target.type = column.type;
  return target;
}

/** @returns {{ target: Target | null, reason?: Reason }} */
export function lookupColumn(/** @type {Scope} */ scope, /** @type {string} */ name) {
  for (let level = /** @type {Scope | null} */ (scope); level; level = level.parent) {
    const merged = level.merged.get(name);
    const hit = merged ? columnIn(merged, name) : null;
    if (hit && hit !== "unknown") return { target: hit };
    /** @type {Target[]} */
    const hits = [];
    let unknown = false;
    for (const entry of level.entries) {
      if (entry.named) continue;
      const found = columnIn(entry, name);
      if (found === "unknown") unknown = true;
      else if (found) hits.push(found);
    }
    if (hits.length === 1) return { target: /** @type {Target} */ (hits[0]) };
    if (hits.length > 1) return { target: null, reason: "ambiguous" };
    const whole = level.entries.find((e) => e.name === name);
    if (whole) return { target: { kind: "range", name, of: whole.source } };
    if (unknown) return { target: null, reason: "unread" };
  }
  return { target: null, reason: "missing" };
}

/** The FROM item a qualifier names, nearest level first; `schema` only matches a bare relation. */
export function lookupEntry(
  /** @type {Scope} */ scope,
  /** @type {string | null} */ schema,
  /** @type {string} */ name,
) {
  for (let level = /** @type {Scope | null} */ (scope); level; level = level.parent) {
    const entry = level.entries.find((e) => e.name === name && (!schema || e.schema === schema));
    if (entry) return entry;
  }
  return undefined;
}

/**
 * A ColumnRef, written down part by part. `outputs` holds the select list's aliases a bare name of
 * ORDER BY means first; `fallback` those GROUP BY means when no column has the name.
 * @param {Context} ctx
 * @param {Scope} scope
 * @param {Node} ref a ColumnRef's fields
 * @param {{ outputs?: Scope["outputs"], fallback?: Scope["outputs"] }} [order]
 */
export function bindColumnRef(ctx, scope, ref, order = {}) {
  if (ctx.probe && ref.location === ctx.probe.at) ctx.probe.hit = { scope };
  const fields = listOf(ref.fields);
  const star = kindOf(fields[fields.length - 1]) === "A_Star";
  const parts = fields.filter((f) => kindOf(f) === "String").map((f) => stringOf(f) ?? "");
  if (parts.length === 0) return;
  const spans = spansOf(ctx, ref.location, parts);
  const span = (/** @type {number} */ i) =>
    /** @type {{ start: number, end: number }} */ (spans[i]);
  const last = parts.length - 1;
  if (!star && parts.length === 1) {
    const name = /** @type {string} */ (parts[0]);
    const output = order.outputs?.find((o) => o.name === name);
    if (output) return emit(ctx, "column", name, span(0), { kind: "output", ...output });
    const found = lookupColumn(scope, name);
    const late = !found.target && order.fallback?.find((o) => o.name === name);
    if (late) return emit(ctx, "column", name, span(0), { kind: "output", ...late });
    return emit(ctx, "column", name, span(0), found.target, found.reason);
  }
  const qualifier = star ? parts : parts.slice(0, -1);
  const q = qualifier.length - 1;
  const name = /** @type {string} */ (qualifier[q]);
  const schema = q >= 1 ? /** @type {string} */ (qualifier[q - 1]) : null;
  const entry = lookupEntry(scope, schema, name);
  if (!entry) {
    // `a.b` may be field b of a composite column a; the field is the type's, not a schema object.
    const column = !star && parts.length === 2 ? lookupColumn(scope, name) : null;
    if (column?.target?.kind === "column") return emit(ctx, "column", name, span(0), column.target);
    return emit(ctx, "qualifier", name, span(q), null, "missing");
  }
  if (schema) emit(ctx, "schema", schema, span(q - 1), { kind: "schema", name: schema });
  emit(ctx, "qualifier", name, span(q), { kind: "range", name, of: entry.source });
  if (star) return;
  const column = /** @type {string} */ (parts[last]);
  const hit = columnIn(entry, column);
  if (hit === "unknown") emit(ctx, "column", column, span(last), null, "unread");
  else emit(ctx, "column", column, span(last), hit, hit ? undefined : "missing");
}

/** A FROM item named alone (FOR UPDATE OF t). */
export function bindQualifier(
  /** @type {Context} */ ctx,
  /** @type {Scope} */ scope,
  /** @type {string} */ name,
  /** @type {number | undefined} */ location,
) {
  const entry = lookupEntry(scope, null, name);
  const span = /** @type {{ start: number, end: number }} */ (spansOf(ctx, location, [name])[0]);
  emit(ctx, "qualifier", name, span, entry ? { kind: "range", name, of: entry.source } : null);
}
