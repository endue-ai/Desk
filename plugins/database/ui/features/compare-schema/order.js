// The order objects are created in (PG-53, ADR 0338): an object after everything of the same schema
// its DDL names (a column's type, a default's sequence, a foreign key's table, a view's tables and
// views, a trigger's table and function), the kinds' order where nothing decides, and a cycle broken
// at the first object by kind and name. Drops go in the reverse order. Pure.

import { KINDS, keyOf } from "./model.js";
import { namesIn } from "./normalize.js";

/** @typedef {import("./model.js").Obj} Obj */

/** The name an object is mentioned by: a function's without its arguments, a trigger's never. */
const calledBy = (/** @type {Obj} */ o) =>
  o.kind === "trigger" ? "" : o.kind === "function" ? o.name.replace(/\(.*$/su, "") : o.name;

/** What an object's DDL mentions that may be another object. */
function mentioned(/** @type {Obj} */ o) {
  if (o.kind === "table" && o.table) {
    const d = o.table;
    const texts = [
      ...d.columns.flatMap((c) => [c.type.split(".").at(-1) ?? "", c.default, c.generated]),
      ...d.checks.map((c) => c.expression),
      ...d.foreignKeys.map((f) => (f.self ? "" : `"${f.refTable.replaceAll('"', '""')}"`)),
    ];
    const names = new Set();
    for (const t of texts) for (const n of namesIn(t)) names.add(n);
    for (const c of d.columns) names.add(c.type.split(".").at(-1) ?? "");
    return names;
  }
  if (o.kind === "function") return new Set();
  if (o.kind === "trigger") return new Set([...namesIn(o.ddl), o.on ?? ""]);
  return namesIn(o.body ?? o.ddl);
}

/**
 * Objects in an order that creates each after what it needs.
 * @param {Obj[]} objects
 * @returns {Obj[]}
 */
export function createOrder(objects) {
  const rank = (/** @type {Obj} */ o) => KINDS.indexOf(o.kind);
  const byName = new Map();
  for (const o of objects) {
    const name = calledBy(o);
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), o]);
  }
  /** @type {Map<Obj, Set<Obj>>} */
  const needs = new Map();
  for (const o of objects) {
    const set = new Set();
    for (const name of mentioned(o))
      for (const other of byName.get(name) ?? []) if (other !== o) set.add(other);
    needs.set(o, set);
  }
  const cmp = (/** @type {Obj} */ a, /** @type {Obj} */ b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return rank(a) - rank(b) || (ka < kb ? -1 : ka > kb ? 1 : 0);
  };
  /** @type {Map<Obj, Obj[]>} */
  const users = new Map(objects.map((o) => [o, []]));
  const waiting = new Map();
  for (const [o, set] of needs) {
    waiting.set(o, set.size);
    for (const n of set) users.get(n)?.push(o);
  }
  const left = new Set(objects);
  /** @type {Obj[]} */
  let ready = objects.filter((o) => waiting.get(o) === 0).sort(cmp);
  /** @type {Obj[]} */
  const out = [];
  while (left.size) {
    // A cycle: the first of what is left goes first.
    const next = /** @type {Obj} */ (ready.length ? ready.shift() : [...left].sort(cmp)[0]);
    if (!left.has(next)) continue;
    out.push(next);
    left.delete(next);
    const freed = [];
    for (const u of users.get(next) ?? []) {
      const count = waiting.get(u) - 1;
      waiting.set(u, count);
      if (count === 0 && left.has(u)) freed.push(u);
    }
    if (freed.length) ready = [...ready, ...freed].sort(cmp);
  }
  return out;
}

/** The reverse: what drops each object before what it needs. */
export const dropOrder = (/** @type {Obj[]} */ objects) => createOrder(objects).reverse();
