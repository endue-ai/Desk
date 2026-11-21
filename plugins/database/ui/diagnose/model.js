// The schema model the problems check binds names against (ADR 0294): what a connection's schema
// cache holds now (schema-cache/view.js), read without asking the server. A schema the cache lists
// but did not read is in the model by name alone, so its names are "not read" rather than missing;
// a system schema it did not read is left out (the resolver knows pg_catalog's own names); sequences
// have no column list. Partitions, which the cache reads under their root table (PG-50, ADR 0295),
// are relations of the schema each lives in, with the root's columns. The model is kept per
// connection while the cache does not change, so the worker gets it once.

/**
 * @typedef {import("../sql/parse/model.js").SchemaModel} SchemaModel
 * @typedef {import("../sql/parse/model.js").ModelSchema} ModelSchema
 * @typedef {import("../schema-cache/view.js").CacheView} CacheView
 */

const RELATIONS = new Set(["table", "view", "materialized view", "foreign table", "sequence"]);

/** @type {Map<string, { key: string, model: SchemaModel | null }>} */
const kept = new Map();

/** One held schema's relations and routines. @returns {ModelSchema} */
function schemaOf(/** @type {CacheView} */ view, /** @type {string} */ name) {
  const relations = (view.objects(name) ?? [])
    .filter((o) => RELATIONS.has(o.kind))
    .map((o) => {
      const columns = o.kind === "sequence" ? undefined : view.columns(name, o.name);
      return {
        name: o.name,
        kind: o.kind,
        ...(columns ? { columns: columns.map((c) => ({ name: c.name, type: c.type })) } : {}),
      };
    });
  const routines = (view.routines(name) ?? []).map((r) => ({
    name: r.name,
    kind: r.kind,
    args: r.args,
    result: r.result,
  }));
  return { name, relations, routines };
}

/**
 * The partitions under a held schema's partitioned tables, at every level, each with the schema it
 * lives in and its root's columns (a partition has its parent's columns).
 * @returns {Array<[string, import("../sql/parse/model.js").ModelRelation]>}
 */
function partitionsOf(/** @type {CacheView} */ view, /** @type {ModelSchema} */ schema) {
  /** @type {Array<[string, import("../sql/parse/model.js").ModelRelation]>} */
  const found = [];
  for (const root of schema.relations ?? []) {
    for (const part of view.parts(schema.name, root.name) ?? []) {
      if (part.kind !== "partition") continue;
      const def = /** @type {{ schema?: unknown, foreign?: unknown }} */ (part.def ?? {});
      const at = typeof def.schema === "string" && def.schema ? def.schema : schema.name;
      const kind = def.foreign === true ? "foreign table" : "table";
      found.push([
        at,
        { name: part.name, kind, ...(root.columns ? { columns: root.columns } : {}) },
      ]);
    }
  }
  return found;
}

/**
 * The model of a connection's cache, or null when it lists nothing yet.
 * @param {string} connection the connection's id
 * @param {CacheView | undefined} view
 * @returns {SchemaModel | null}
 */
export function problemModel(connection, view) {
  if (!view) return null;
  const states = view.all();
  const key = `${view.readAt}|${states.map((s) => `${s.name}:${s.held ? 1 : 0}`).join(",")}`;
  const before = kept.get(connection);
  if (before?.key === key) return before.model;
  const listed = states.filter((s) => s.held || !s.system);
  /** @type {ModelSchema[]} */
  const schemas = listed.map((s) => (s.held ? schemaOf(view, s.name) : { name: s.name }));
  for (const [at, partition] of schemas.flatMap((s) =>
    s.relations ? partitionsOf(view, s) : [],
  )) {
    const home = schemas.find((s) => s.name === at);
    if (home?.relations && !home.relations.some((r) => r.name === partition.name))
      home.relations.push(partition);
  }
  const model = listed.length === 0 ? null : { schemas };
  kept.set(connection, { key, model });
  return model;
}
