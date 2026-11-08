// What the explorer shows below a schema and a table, the same for every engine: objects (tables,
// views, sequences, routines ...) with a row estimate where the server keeps one, and a table's
// parts (keys, checks, foreign keys, indexes, triggers) with their definitions. Pure.

/**
 * @typedef {"table" | "view" | "materialized view" | "foreign table" | "sequence" | "function" | "procedure" | "event"} ObjectKind
 * @typedef {"primary key" | "unique" | "check" | "exclusion" | "foreign key" | "index" | "trigger" | "constraint"} PartKind
 * @typedef {{ schema: string, name: string, kind: ObjectKind, detail: string, rows: number | null, ident: string }} SchemaObject
 *   `ident` is what names it in the catalog beyond its name (PostgreSQL's oid, for an overloaded routine).
 * @typedef {{ schema: string, table: string, kind: PartKind, name: string, detail: string, extra: string }} Part
 *   `detail` is its definition (or its columns); `extra` the referenced table of a foreign key, or
 *   "constraint" for an index a constraint owns.
 */

/** The folders of a schema, by the kinds they hold, in the explorer's order. */
export const OBJECT_FOLDERS = /** @type {const} */ ([
  ["Tables", ["table", "foreign table"]],
  ["Views", ["view"]],
  ["Materialized views", ["materialized view"]],
  ["Sequences", ["sequence"]],
  ["Routines", ["function", "procedure"]],
  ["Events", ["event"]],
]);

/** The folders of a table, by the kinds of parts they hold. */
export const PART_FOLDERS = /** @type {const} */ ([
  ["Keys", ["primary key", "unique", "exclusion", "check", "constraint"]],
  ["Foreign keys", ["foreign key"]],
  ["Indexes", ["index"]],
  ["Triggers", ["trigger"]],
]);

/** Kinds whose rows can be counted and opened. */
export const RELATIONS = new Set(["table", "view", "materialized view", "foreign table"]);

/**
 * Rows of name, kind, detail, estimate, ident as objects of a schema.
 * @param {(string | null)[][]} rows
 * @param {string} schema
 * @returns {SchemaObject[]}
 */
export function objectsOf(rows, schema) {
  return rows.map(([name, kind, detail, estimate, ident]) => {
    const rows =
      estimate === null || estimate === undefined || estimate === "" ? null : Number(estimate);
    return {
      schema,
      name: name ?? "",
      kind: /** @type {ObjectKind} */ (kind ?? "table"),
      detail: detail ?? "",
      rows: rows !== null && Number.isFinite(rows) && rows >= 0 ? rows : null,
      ident: ident ?? "",
    };
  });
}

/**
 * Rows of kind, name, definition, extra as parts of a table.
 * @param {(string | null)[][]} rows
 * @param {{ schema: string, name: string }} table
 * @returns {Part[]}
 */
export function partsOf(rows, table) {
  return rows.map(([kind, name, detail, extra]) => ({
    schema: table.schema,
    table: table.name,
    kind: /** @type {PartKind} */ (kind ?? "constraint"),
    name: name ?? "",
    detail: detail ?? "",
    extra: extra ?? "",
  }));
}

/** A statement with one `;` at its end and a line break after it. */
export function closeStatement(/** @type {string} */ sql) {
  const body = sql.trim().replace(/;+$/u, "").trimEnd();
  return body ? `${body};\n` : "";
}
