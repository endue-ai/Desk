// Two designs of one table, read from two places, made comparable by the table form's ALTER writer
// (PG-53, ADR 0338): PG-51's alterSteps matches parts by id, and ids are a read's own. So the source's
// design takes the target's ids: a column by its name, a constraint or an index by what it holds; a
// name PostgreSQL made up stays the target's, a chosen one is renamed; text that differs only in
// formatting becomes the target's text; columns keep the target's order (PostgreSQL moves none) and
// new ones come after. The source's schema becomes the target's. Pure.

import { generatedName, partKey } from "./table.js";
import { norm } from "./normalize.js";

/**
 * @typedef {import("../table-design/model.js").Design} Design
 * @typedef {import("../table-design/model.js").Column} Column
 */

/** `now`'s text where it reads as `was`'s, else its own. */
const same = (
  /** @type {string} */ was,
  /** @type {string} */ now,
  /** @type {string[]} */ schemas,
) => (norm(was, schemas[0]) === norm(now, schemas[1]) ? was : now);

/**
 * The source's design under the target's ids.
 * @param {Design} was The target's design.
 * @param {Design} now The source's design.
 * @param {{ source: string, target: string }} schemas
 * @returns {Design}
 */
export function align(was, now, { source, target }) {
  const sch = [target, source];
  /** @type {Map<string, string>} */
  const ids = new Map();
  let fresh = 0;
  /** @type {Column[]} */
  const matched = [];
  /** @type {Column[]} */
  const added = [];
  for (const c of now.columns) {
    const w = was.columns.find((x) => x.name === c.name);
    const id = w ? w.id : `s${++fresh}`;
    ids.set(c.id, id);
    const col = {
      ...c,
      id,
      default: w ? same(w.default, c.default, sch) : c.default,
      generated: w ? same(w.generated, c.generated, sch) : c.generated,
    };
    (w ? matched : added).push(col);
  }
  matched.sort(
    (a, b) =>
      was.columns.findIndex((c) => c.id === a.id) - was.columns.findIndex((c) => c.id === b.id),
  );
  const col = (/** @type {string} */ id) => ids.get(id) ?? id;
  const keys = (/** @type {import("../table-design/model.js").Key[]} */ list) =>
    list.map((k) => (k.column ? { ...k, column: col(k.column) } : k));

  /** @type {Design} */
  const moved = {
    ...now,
    schema: target,
    owner: was.owner,
    columns: [...matched, ...added],
    primaryKey: now.primaryKey && { ...now.primaryKey, columns: now.primaryKey.columns.map(col) },
    uniques: now.uniques.map((u) => ({ ...u, columns: u.columns.map(col) })),
    checks: now.checks.map((c) => ({ ...c })),
    foreignKeys: now.foreignKeys.map((fk) => ({
      ...fk,
      columns: fk.columns.map(col),
      refColumns: fk.self ? fk.refColumns.map(col) : fk.refColumns,
      refSchema: fk.refSchema === source ? target : fk.refSchema,
    })),
    indexes: now.indexes.map((i) => ({ ...i, keys: keys(i.keys) })),
    others: now.others.map((o) => ({ ...o })),
    partition: { ...now.partition, keys: keys(now.partition.keys) },
  };

  // Parts by what they hold: the target's id, its name when either name is made up.
  /** @type {[string, any[], any[]][]} */
  const lists = [
    ["primary", was.primaryKey ? [was.primaryKey] : [], moved.primaryKey ? [moved.primaryKey] : []],
    ["unique", was.uniques, moved.uniques],
    ["check", was.checks, moved.checks],
    ["foreign", was.foreignKeys, moved.foreignKeys],
    ["index", was.indexes, moved.indexes],
    ["other", was.others, moved.others],
  ];
  for (const [kind, wl, nl] of lists) {
    const free = wl.map((w) => ({ w, key: partKey(was, /** @type {any} */ (kind), w, target) }));
    for (const n of nl) {
      const key = partKey(moved, /** @type {any} */ (kind), n, target);
      const at = free.findIndex((f) => f.key === key);
      if (at < 0) {
        n.id = `s${++fresh}`;
        continue;
      }
      const { w } = /** @type {{ w: any }} */ (free.splice(at, 1)[0]);
      n.id = w.id;
      if (generatedName(n.name, now.name) || generatedName(w.name, was.name)) n.name = w.name;
      if (kind === "check") n.expression = w.expression;
      if (kind === "index") {
        n.where = w.where;
        n.keys = w.keys;
      }
      if (n.kept !== undefined) n.kept = w.kept;
    }
  }
  return moved;
}
