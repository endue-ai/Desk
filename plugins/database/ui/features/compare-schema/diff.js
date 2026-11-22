// Two schemas compared (PG-53, ADR 0338): each object by kind and name on both sides, listed when it
// is on one side only or when what it is made of differs, with its DDL on both sides. What is no
// difference (normalize.js, table.js) leaves an object out: formatting, order, the schema's own name,
// names PostgreSQL makes up. Pure; the worker (worker.js) runs it past a few thousand objects.

import { keyOf, KINDS, sorted } from "./model.js";
import { norm } from "./normalize.js";
import { tableSignature } from "./table.js";

/**
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("./model.js").Model} Model
 * @typedef {"left" | "right" | "differs"} State
 *   `left`: on the left side only; `right`: on the right side only.
 * @typedef {{ key: string, kind: Obj["kind"], name: string, state: State, left: string, right: string }} Item
 *   `left` and `right` are the object's DDL on each side ("" where it is not).
 * @typedef {{ items: Item[], same: number, left: number, right: number }} Comparison
 */

/** What an object is compared by. */
export function signatureOf(/** @type {Obj} */ o, /** @type {string} */ schema) {
  if (o.held) return `held ${norm(o.ddl, schema)}`;
  if (o.kind === "table" && o.table) return tableSignature(o, schema);
  if (o.kind === "sequence" && o.sequence) return JSON.stringify(o.sequence);
  if (o.kind === "type" && o.typeKind === "enum") return `enum ${JSON.stringify(o.labels ?? [])}`;
  if ((o.kind === "view" || o.kind === "materialized view") && o.body !== undefined)
    return norm(o.body, schema);
  return norm(o.ddl, schema);
}

/** One key's item, or null when both sides hold the same. */
export function itemOf(
  /** @type {string} */ key,
  /** @type {Obj | undefined} */ l,
  /** @type {Obj | undefined} */ r,
  /** @type {{ left: string, right: string }} */ schemas,
) {
  const o = /** @type {Obj} */ (l ?? r);
  if (l && r && signatureOf(l, schemas.left) === signatureOf(r, schemas.right)) return null;
  /** @type {Item} */
  const item = {
    key,
    kind: o.kind,
    name: o.name,
    state: l && r ? "differs" : l ? "left" : "right",
    left: l?.ddl ?? "",
    right: r?.ddl ?? "",
  };
  return item;
}

/** Every key of both sides, in a stable order. */
export function keysOf(/** @type {Model} */ left, /** @type {Model} */ right) {
  const all = new Map();
  for (const o of [...sorted(left.objects), ...sorted(right.objects)]) all.set(keyOf(o), o);
  return sorted([...all.values()]).map(keyOf);
}

/**
 * Compare two models; `tick` hears how many keys are done every `every` keys.
 * @param {Model} left
 * @param {Model} right
 * @param {{ tick?(done: number, total: number): void, every?: number }} [how]
 * @returns {Comparison}
 */
export function compareModels(left, right, { tick, every = 500 } = {}) {
  const l = new Map(left.objects.map((o) => [keyOf(o), o]));
  const r = new Map(right.objects.map((o) => [keyOf(o), o]));
  const keys = keysOf(left, right);
  const schemas = { left: left.schema, right: right.schema };
  /** @type {Item[]} */
  const items = [];
  let same = 0;
  keys.forEach((key, i) => {
    const item = itemOf(key, l.get(key), r.get(key), schemas);
    if (item) items.push(item);
    else same++;
    if (tick && (i + 1) % every === 0) tick(i + 1, keys.length);
  });
  tick?.(keys.length, keys.length);
  return {
    items,
    same,
    left: left.objects.length,
    right: right.objects.length,
  };
}

/** The kinds in their order, for grouping a list. */
export const KIND_ORDER = KINDS;
