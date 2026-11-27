// Forgetting the SSH host keys a connection's tunnel trusts (PG-10, ADR 0359): after the person's
// yes, db.hostKeys.delete for the SSH host and the jump host, so the next connect shows the
// server's key again. A changed key is refused until this runs; nothing else forgets one.

import { t } from "../../strings/index.js";
import { hopsOf } from "../../tunnel/open.js";

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "tunnel",
  commands: (deps) => ({
    "endue.database.forget-ssh-host-key": async ({ connection }) => {
      const conn = await deps.manager.choose(
        connection,
        t("features.tunnel.index.databaseForgetTheSshHostKey"),
      );
      if (!conn) return undefined;
      const hops = hopsOf(conn);
      if (!hops.length)
        throw new Error(t("features.tunnel.index.hasNoSshTunnel", { name: String(conn.name) }));
      const names = hops.map((hop) => `${hop.host}:${hop.port}`).join(" and ");
      const yes = await deps.confirm(
        t("features.tunnel.index.forgetTheSshHostKeyOf", { names: String(names) }),
        [
          t("features.tunnel.index.theNextConnectShowsTheServer"),
          t("features.tunnel.index.doThisOnlyWhenYouKnow"),
        ],
      );
      if (!yes) throw deps.cancelled(t("features.tunnel.index.keptTheSshHostKey"));
      for (const hop of hops)
        await deps.bridge.call(/** @type {never} */ ("db.hostKeys.delete"), {
          host: hop.host,
          port: hop.port,
        });
      deps.say(t("features.tunnel.index.forgotTheSshHostKeyOf", { names: String(names) }));
      return undefined;
    },
  }),
};
