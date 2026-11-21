// The schema model the problems check binds names against (ADR 0294): what a connection's schema
// cache holds now (schema-cache/view.js), read without asking the server. A schema the cache lists
// but did not read is in the model by name alone, so its names are "not read" rather than missing;
// a system schema it did not read is left out (the resolver knows pg_catalog's own names); sequences
// have no column list; partitioned tables are marked, since the cache leaves their partitions out.
// The model is kept per connection while the cache does not change, so the worker gets it once.

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
        ...(o.detail === "partitioned" ? { partitioned: true } : {}),
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
  const model =
    listed.length === 0
      ? null
      : { schemas: listed.map((s) => (s.held ? schemaOf(view, s.name) : { name: s.name })) };
  kept.set(connection, { key, model });
  return model;
}
