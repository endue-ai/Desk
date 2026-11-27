// The schema the resolver binds names to: schemas, their relations with their columns, and their
// routines, as the explorer's catalog reads them (ui/catalog.js, ui/schema/postgres.js). What has not
// been read is left out (`relations` or `columns` undefined), so the resolver can tell "not there"
// from "not read". Pure: the model crosses to the parse worker as data.

/**
 * @typedef {import("../../schema/common.js").SchemaObject} SchemaObject
 * @typedef {{ name: string, type?: string, notNull?: boolean, comment?: string, default?: boolean }} ModelColumn
 * @typedef {{ columns: string[], schema: string, table: string, refColumns: string[] }} ModelKey
 * @typedef {{
 *   name: string, kind: string, columns?: ModelColumn[], indexes?: string[], comment?: string,
 *   foreignKeys?: ModelKey[],
 * }} ModelRelation
 *   `notNull` and `indexes` (the index definitions) come from the schema cache, for the warnings;
 *   comments, defaults, foreign keys and types are completion's (ADR 0327). The resolver reads
 *   names and types alone.
 * @typedef {{ name: string, kind: string, args: string, result?: string, comment?: string }} ModelRoutine
 * @typedef {{ name: string, relations?: ModelRelation[], routines?: ModelRoutine[], types?: Array<{ name: string, type: string }> }} ModelSchema
 * @typedef {{ schemas: ModelSchema[] }} SchemaModel
 * @typedef {{
 *   relation: ModelRelation, columns: Map<string, ModelColumn> | null,
 * }} IndexedRelation
 * @typedef {{
 *   name: string, relations: Map<string, IndexedRelation> | null,
 *   routines: Map<string, ModelRoutine[]> | null, types?: Array<{ name: string, type: string }>,
 * }} IndexedSchema
 * @typedef {Map<string, IndexedSchema>} ModelIndex
 */

const RELATION_KINDS = new Set(["table", "view", "materialized view", "foreign table", "sequence"]);
const ROUTINE_KINDS = new Set(["function", "procedure"]);

/** A routine as the catalog lists it, `name(identity arguments)`, split into name and arguments. */
export function routineOf(/** @type {SchemaObject} */ object) {
  const open = object.name.indexOf("(");
  return {
    name: open < 0 ? object.name : object.name.slice(0, open),
    kind: object.kind,
    args: open < 0 ? "" : object.name.slice(open + 1, object.name.endsWith(")") ? -1 : undefined),
    ...(object.detail ? { result: object.detail } : {}),
  };
}

/**
 * The model from what the catalog has read: the schemas, each schema's objects (undefined when not
 * read) and each relation's columns (undefined when not read).
 * @param {{
 *   schemas: string[],
 *   objects(schema: string): SchemaObject[] | undefined,
 *   columns(schema: string, relation: string): Array<{ name: string, type?: string }> | undefined,
 * }} read
 * @returns {SchemaModel}
 */
export function modelOf({ schemas, objects, columns }) {
  return {
    schemas: schemas.map((name) => {
      const all = objects(name);
      if (!all) return { name };
      return {
        name,
        relations: all
          .filter((o) => RELATION_KINDS.has(o.kind))
          .map((o) => {
            const read = columns(name, o.name);
            return {
              name: o.name,
              kind: o.kind,
              ...(read ? { columns: read.map((c) => ({ name: c.name, type: c.type })) } : {}),
            };
          }),
        routines: all.filter((o) => ROUTINE_KINDS.has(o.kind)).map(routineOf),
      };
    }),
  };
}

/** The model by name, for lookups. @returns {ModelIndex} */
export function indexModel(/** @type {SchemaModel} */ model) {
  /** @type {ModelIndex} */
  const index = new Map();
  for (const schema of model.schemas) {
    /** @type {Map<string, ModelRoutine[]> | null} */
    let routines = null;
    if (schema.routines) {
      routines = new Map();
      for (const routine of schema.routines) {
        const same = routines.get(routine.name);
        if (same) same.push(routine);
        else routines.set(routine.name, [routine]);
      }
    }
    index.set(schema.name, {
      name: schema.name,
      relations: schema.relations
        ? new Map(
            schema.relations.map((relation) => [
              relation.name,
              {
                relation,
                columns: relation.columns
                  ? new Map(relation.columns.map((c) => [c.name, c]))
                  : null,
              },
            ]),
          )
        : null,
      routines,
      ...(schema.types ? { types: schema.types } : {}),
    });
  }
  return index;
}
