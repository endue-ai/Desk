// A PostgreSQL server's version, for the EXPLAIN options it has: SHOW server_version_num, run once
// per connection through the executor as the plugin's own reading (it asks nothing but a password),
// and kept for the session. A version that cannot be read is the floor's and is asked again.
import { FLOOR, versionOf } from "./options.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {(conn: Connection, sql: string, options?: import("../execute.js").ExecuteOptions) => Promise<import("../execute.js").Execution>} Execute
 */

/** @param {Execute} execute @returns {(conn: Connection) => Promise<number>} */
export function createVersions(execute) {
  /** @type {Map<string, number>} */
  const known = new Map();
  return async (conn) => {
    if (conn.engine !== "postgresql") return 0;
    const hit = known.get(conn.id);
    if (hit !== undefined) return hit;
    const done = await execute(conn, "SHOW server_version_num", { catalog: true }).catch(
      () => null,
    );
    const value = done?.result.statements[0]?.sets[0]?.rows[0]?.[0];
    if (!value) return FLOOR;
    const version = versionOf(value);
    known.set(conn.id, version);
    return version;
  };
}
