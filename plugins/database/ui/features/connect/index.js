// Allow connecting (PG-01g, ADR 0335): the person's press that asks again for a connection's server
// after a refusal, from the palette or beside a refused run's line. It asks through perm.request
// with `again` (session/connect-gate.js), so the core asks even after a refusal earlier in the
// session; granted, the reads that waited for it run.

import { allowConnect, whereOf } from "../../session/connect-gate.js";
import { t } from "../../strings/index.js";

/**
 * @param {import("../../feature-host.js").Deps} deps
 * @param {import("../../engines/common.js").Connection} conn
 */
async function allow(deps, conn) {
  const where = whereOf(conn);
  if (!where)
    throw new Error(
      t("features.connect.index.connectsThroughAClientProgramWhich", { name: String(conn.name) }),
    );
  const allowed = await allowConnect(deps.bridge, conn);
  deps.say(
    allowed
      ? t("features.connect.index.mayConnectToNow", {
          name: String(conn.name),
          where: String(where),
        })
      : t("features.connect.index.isStillNotAllowedToConnect", {
          name: String(conn.name),
          where: String(where),
        }),
  );
  return allowed;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "connect",
  commands: (deps) => ({
    "endue.database.allow-connect": async ({ connection }) => {
      const conn = await deps.manager.choose(
        connection,
        t("features.connect.index.databaseAllowConnectingForWhichConnection"),
      );
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
