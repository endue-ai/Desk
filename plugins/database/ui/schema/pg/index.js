// The PostgreSQL kinds of PG-50 in one table: the schema cache's readers (in the order a pass runs
// them), the explorer's folders under a schema, under a table and under the connection's Database
// and Server rows, and each kind's DDL. A new kind is a module here and its lines below. Pure.

import { t } from "../../strings/index.js";
import * as database from "./database.js";
import * as databaseDdl from "./database-ddl.js";
import * as objects from "./objects.js";
import * as server from "./server.js";
import * as tableParts from "./table-parts.js";
import * as types from "./types.js";

/**
 * @typedef {import("../common.js").SchemaObject} SchemaObject
 * @typedef {import("../common.js").Part} Part
 * @typedef {(string | null)[]} Row
 */

/** The cache's readers after PG-06's six: three per schema, then two of the database level. */
export const READERS = /** @type {const} */ ([
  types.reader,
  objects.reader,
  tableParts.reader,
  database.reader,
  server.reader,
]);

/** The cache's name of the database level: no schema can be named "". */
export const DATABASE = "";

/** A schema's folders of the new kinds, after Routines. */
export const SCHEMA_FOLDERS = /** @type {const} */ ([
  ["Types", ["type"]],
  ["Aggregates", ["aggregate"]],
  ["Operators", ["operator"]],
  ["Collations", ["collation"]],
  ["Text search", ["text search configuration"]],
]);

/** A table's folders of the new parts, after Triggers. */
export const TABLE_FOLDERS = /** @type {const} */ ([
  ["Partitions", ["partition"]],
  ["Inherits", ["inherits"]],
  ["Policies", ["policy"]],
  ["Rules", ["rule"]],
]);

/** The rows under a connection after its schemas, each with its folders. */
export const LEVELS = /** @type {const} */ ([
  {
    id: "database",
    label: t("schema.pg.index.database"),
    folders: [
      ["Extensions", ["extension"]],
      ["Foreign data wrappers", ["foreign data wrapper"]],
      ["Foreign servers", ["foreign server"]],
      ["User mappings", ["user mapping"]],
      ["Publications", ["publication"]],
      ["Subscriptions", ["subscription"]],
      ["Event triggers", ["event trigger"]],
      ["Casts", ["cast"]],
      ["Languages", ["language"]],
    ],
  },
  {
    id: "server",
    label: t("schema.pg.index.server"),
    folders: [
      ["Roles", ["role"]],
      ["Tablespaces", ["tablespace"]],
    ],
  },
]);

const SCHEMA_KINDS = new Set(SCHEMA_FOLDERS.flatMap(([, kinds]) => kinds));
const PART_KINDS = new Set(TABLE_FOLDERS.flatMap(([, kinds]) => kinds));
const LEVEL_KINDS = new Set(LEVELS.flatMap((l) => l.folders.flatMap(([, kinds]) => kinds)));

/** Whether a kind is one of PG-50's (its row's detail says what it is). */
export const isNewKind = (/** @type {string} */ kind) =>
  SCHEMA_KINDS.has(kind) || PART_KINDS.has(kind) || LEVEL_KINDS.has(kind);

/**
 * What the new readers add to a schema's objects and parts (the database level's objects under
 * DATABASE), from the rows each read.
 * @param {Record<string, Row[]>} data
 * @param {string} schema
 */
export function lookupOf(data, schema) {
  if (schema === DATABASE)
    return {
      objects: [...database.objectsOf(data.database ?? []), ...server.objectsOf(data.server ?? [])],
      parts: /** @type {Map<string, Part[]>} */ (new Map()),
    };
  return {
    objects: [
      ...types.objectsOf(data.types ?? [], schema),
      ...objects.objectsOf(data.objects ?? [], schema),
    ],
    parts: tableParts.partsOf(data["table parts"] ?? [], schema),
  };
}

/** The queries a new kind's DDL needs on `d` (a base type's I/O functions), or undefined. */
export function ddlQueries(/** @type {SchemaObject | Part} */ object) {
  if (!isNewKind(object.kind)) return undefined;
  return object.kind === "type" ? types.ddlQueries(/** @type {SchemaObject} */ (object)) : [];
}

/** The DDL of a new kind from its cached row, or undefined for another kind. */
export function ddl(
  /** @type {SchemaObject | Part} */ object,
  /** @type {Row[][]} */ results = [],
) {
  if (!isNewKind(object.kind)) return undefined;
  if ("table" in object) return tableParts.ddl(object);
  if (object.kind === "type") return types.ddl(object, results);
  if (SCHEMA_KINDS.has(object.kind)) return objects.ddl(object);
  if (object.kind === "role" || object.kind === "tablespace") return server.ddl(object);
  return databaseDdl.ddl(object) ?? "";
}
