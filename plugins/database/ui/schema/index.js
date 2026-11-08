// Each engine's objects and DDL, by engine id.

import * as mysql from "./mysql.js";
import * as postgres from "./postgres.js";
import * as sqlite from "./sqlite.js";

/**
 * @typedef {import("../engines/common.js").EngineId} EngineId
 * @typedef {import("./common.js").SchemaObject} SchemaObject
 * @typedef {import("./common.js").Part} Part
 * @typedef {{
 *   objects(schema: string): string[],
 *   parts(schema: string, table: string): string[],
 *   ddlQueries(object: SchemaObject | Part): string[],
 *   ddl(object: SchemaObject | Part, results: (string | null)[][][], columns?: string[][]): string,
 * }} SchemaEngine
 */

/** @type {Record<EngineId, SchemaEngine>} */
const SCHEMAS = { postgresql: postgres, mysql, sqlite };

/** @returns {SchemaEngine} */
export function schemaOf(/** @type {EngineId} */ engine) {
  return SCHEMAS[engine];
}
