// The names a schema cache holds, as the palette searches them (PG-80): per held schema, its
// tables, views, routines and types, then their columns, and the schemas themselves. A schema's
// names are made once per read of it: a cache answers the same objects list until it reads the
// schema again, so they are kept beside that list. Pure.

import { DATABASE } from "../../schema-cache/kinds.js";

/**
 * @typedef {import("../../schema-cache/view.js").CacheView} CacheView
 * @typedef {{
 *   name: string, qualified: string, rank: number,
 *   kind: string, title: string, schema: string, table: string, type: string,
 * }} Name
 *   `name` and `qualified` are lowercase for matching; `title` the name as the row shows it (a
 *   routine with its arguments); `table` a column's table and `type` its type, else "".
 */

/** The kinds the palette finds, in the order of ties; a routine is a function or a procedure. */
export const KINDS = /** @type {const} */ ([
  "table",
  "view",
  "materialized view",
  "foreign table",
  "function",
  "procedure",
  "type",
  "schema",
  "column",
]);
const RANK = new Map(KINDS.map((kind, i) => [kind, i]));
/** The kinds whose rows open, and whose columns are found. */
export const RELATIONS = new Set(["table", "view", "materialized view", "foreign table"]);

/** @type {WeakMap<object, Name[]>} */
const made = new WeakMap();

/** One name: `qualified` is the schema's (and the table's) dotted before it. */
function nameOf(
  /** @type {string} */ kind,
  /** @type {string} */ title,
  /** @type {string} */ schema,
  table = "",
  type = "",
) {
  const name = title.toLowerCase();
  const qualified = [schema, table, title].filter(Boolean).join(".").toLowerCase();
  return {
    name,
    qualified,
    rank: RANK.get(kind) ?? KINDS.length,
    kind,
    title,
    schema,
    table,
    type,
  };
}

/**
 * A held schema's names: its objects of the kinds above, then the columns of its relations.
 * @param {CacheView} view
 * @param {string} schema
 * @returns {Name[]}
 */
export function schemaNames(view, schema) {
  const objects = view.objects(schema);
  if (!objects) return [];
  const kept = made.get(objects);
  if (kept) return kept;
  /** @type {Name[]} */
  const names = [];
  /** @type {Name[]} */
  const columns = [];
  for (const object of objects) {
    if (!RANK.has(object.kind) || object.kind === "schema" || object.kind === "column") continue;
    names.push(nameOf(object.kind, object.name, schema));
    if (!RELATIONS.has(object.kind)) continue;
    for (const column of view.columns(schema, object.name) ?? [])
      columns.push(nameOf("column", column.name, schema, object.name, column.type));
  }
  for (const column of columns) names.push(column);
  made.set(objects, names);
  return names;
}

/**
 * A cache's names in blocks: one per held schema, then one of the schemas it lists.
 * @param {CacheView} view
 * @returns {Name[][]}
 */
export function namesOf(view) {
  const held = view.schemas().filter((s) => s !== DATABASE);
  const blocks = held.map((schema) => schemaNames(view, schema));
  const listed = [...new Set([...view.listed(), ...held])];
  blocks.push(listed.map((schema) => nameOf("schema", schema, "")));
  return blocks;
}
