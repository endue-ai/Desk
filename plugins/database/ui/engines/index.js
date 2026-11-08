// The engines by id. Each knows its client, how to plan a run, how to read the client's output and
// the catalog queries the explorer runs.

import { mysql } from "./mysql.js";
import { postgres } from "./postgres.js";
import { sqlite } from "./sqlite.js";

/**
 * @typedef {import("./common.js").EngineId} EngineId
 * @typedef {typeof postgres | typeof mysql | typeof sqlite} Engine
 */

/** @type {Record<EngineId, Engine>} */
export const ENGINES = { postgresql: postgres, mysql, sqlite };

/** @returns {Engine} */
export function engineOf(/** @type {EngineId} */ id) {
  const engine = ENGINES[id];
  if (!engine) throw new Error(`Unknown engine: ${String(id)}.`);
  return engine;
}

/** The SQL a table's page runs: its rows, filtered and ordered as the person typed, LIMIT and OFFSET. */
export function pageSql(
  /** @type {string} */ from,
  /** @type {{ where?: string, order?: string, limit: number, offset: number }} */ page,
) {
  const where = page.where?.trim() ? ` WHERE ${page.where.trim()}` : "";
  const order = page.order?.trim() ? ` ORDER BY ${page.order.trim()}` : "";
  return `SELECT * FROM ${from}${where}${order} LIMIT ${page.limit} OFFSET ${page.offset}`;
}

/** The SQL that counts a table's rows under the same filter. */
export function countSql(/** @type {string} */ from, /** @type {string | undefined} */ where) {
  return `SELECT count(*) FROM ${from}${where?.trim() ? ` WHERE ${where.trim()}` : ""}`;
}
