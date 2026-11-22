// Allow connecting (PG-01g, ADR 0335): the person's press that asks again for a connection's server
// after a refusal, from the palette or beside a refused run's line. It asks through perm.request
// with `again` (session/connect-gate.js), so the core asks even after a refusal earlier in the
// session; granted, the reads that waited for it run.

import { allowConnect, whereOf } from "../../session/connect-gate.js";

/**
 * @param {import("../../feature-host.js").Deps} deps
 * @param {import("../../engines/common.js").Connection} conn
 */
async function allow(deps, conn) {
  const where = whereOf(conn);
  if (!where) throw new Error(`${conn.name} connects through a client program, which asks nothing.`);
  const allowed = await allowConnect(deps.bridge, conn);
  deps.say(
    allowed
      ? `${conn.name} may connect to ${where} now.`
      : `${conn.name} is still not allowed to connect to ${where}.`,
  );
  return allowed;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "connect",
  commands: (deps) => ({
    "endue.database.allow-connect": async ({ connection }) => {
      const conn = await deps.manager.choose(connection, "Database: allow connecting for which connection?");
      return conn ? allow(deps, conn) : undefined;
    },
  }),
  actions: (deps) => ({
    allowConnect: async (/** @type {string} */ connection) => {
      const conn = deps.manager.get(connection);
      return conn ? allow(deps, conn) : undefined;
    },
  }),
};
