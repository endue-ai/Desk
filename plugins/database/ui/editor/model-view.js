// The schema completion reads in the parse worker (ADR 0327): the schema model the problems check
// binds against, as the script's state left it before the statement at the caret (its search path
// and the relations it made, diagnose/script.js), answered as complete.js's SchemaView: tables with
// their comments, columns with their types, comments and defaults, foreign keys both ways, routines,
// types, and the schemas an unqualified name is looked for in. Pure.

import { searchPathOf } from "../diagnose/script.js";
import { effectivePath } from "../sql/parse/scope.js";

/**
 * @typedef {import("../sql/parse/model.js").ModelIndex} ModelIndex
 * @typedef {import("../sql/parse/model.js").ModelKey} ModelKey
 * @typedef {import("../diagnose/script.js").State} State
 * @typedef {import("./complete.js").SchemaView} SchemaView
 */

/** @type {WeakMap<ModelIndex, Map<string, Array<ModelKey & { from: { schema: string, table: string } }>>>} */
const reverse = new WeakMap();

/** The foreign keys that point at each table, by `schema.table`, built once per model. */
function referencesOf(/** @type {ModelIndex} */ index) {
  let found = reverse.get(index);
  if (found) return found;
  found = new Map();
  for (const [schema, held] of index)
    for (const [table, { relation }] of held.relations ?? [])
      for (const key of relation.foreignKeys ?? []) {
        const at = `${key.schema}.${key.table}`;
        found.set(at, [...(found.get(at) ?? []), { ...key, from: { schema, table } }]);
      }
  reverse.set(index, found);
  return found;
}

/**
 * @param {ModelIndex} base the model as the cache holds it
 * @param {State} state what the script before the statement left
 * @returns {SchemaView}
 */
export function modelView(base, state) {
  const index = state.index ?? base;
  const path = effectivePath(searchPathOf(state), state.user).filter((s) => index.has(s));
  const relation = (/** @type {string} */ s, /** @type {string} */ t) =>
    index.get(s)?.relations?.get(t)?.relation;
  const tables = path.filter((s) => s !== "pg_catalog");
  return {
    defaultSchema: tables[0] ?? "public",
    path: tables,
    schemas: () => [...index.keys()].filter((s) => s !== "pg_temp"),
    tables: (s) => {
      const held = index.get(s)?.relations;
      return held
        ? [...held.values()].map(({ relation: r }) => ({
            name: r.name,
            type: r.kind,
            ...(r.comment ? { comment: r.comment } : {}),
          }))
        : undefined;
    },
    columns: (s, t) => relation(s, t)?.columns,
    types: (s) => base.get(s)?.types,
    routines: (s) => {
      const held = index.get(s)?.routines;
      return held ? [...held.values()].flat() : undefined;
    },
    foreignKeys: (s, t) => relation(s, t)?.foreignKeys,
    referencing: (s, t) => referencesOf(base).get(`${s}.${t}`) ?? [],
    comment: (s, t) => relation(s, t)?.comment ?? "",
    visible: (s, t) => tables.find((at) => relation(at, t)) === s,
  };
}
