// Forgetting the SSH host keys a connection's tunnel trusts (PG-10, ADR 0359): after the person's
// yes, db.hostKeys.delete for the SSH host and the jump host, so the next connect shows the
// server's key again. A changed key is refused until this runs; nothing else forgets one.

import { hopsOf } from "../../tunnel/open.js";

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "tunnel",
  commands: (deps) => ({
    "endue.database.forget-ssh-host-key": async ({ connection }) => {
      const conn = await deps.manager.choose(
        connection,
        "Database: forget the SSH host key of which connection?",
      );
      if (!conn) return undefined;
      const hops = hopsOf(conn);
      if (!hops.length) throw new Error(`${conn.name} has no SSH tunnel.`);
      const names = hops.map((hop) => `${hop.host}:${hop.port}`).join(" and ");
      const yes = await deps.confirm(`Forget the SSH host key of ${names}?`, [
        "The next connect shows the server's key again, to be checked and trusted.",
        "Do this only when you know the server's key was replaced.",
      ]);
      if (!yes) throw deps.cancelled("Kept the SSH host key.");
      for (const hop of hops)
        await deps.bridge.call(/** @type {never} */ ("db.hostKeys.delete"), {
          host: hop.host,
          port: hop.port,
        });
      deps.say(`Forgot the SSH host key of ${names}.`);
      return undefined;
    },
  }),
};
