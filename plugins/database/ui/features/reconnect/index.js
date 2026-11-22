// Reconnect (PG-105, ADR 0355): the lost PostgreSQL session of the console or table view on screen
// opened again now, as the person's act, its tries on its own dropped. It runs nothing of the
// person's: a SET, temporary tables and a transaction the lost session held are gone, and their
// statements are not run again. The header's button and a command. No DOM.

import { ownerOf } from "../../session/owners.js";

/** @typedef {import("../../feature-host.js").Deps} Deps */

/** Reconnect the session of the buffer on screen; the status line's words. */
async function reconnect(/** @type {Deps} */ deps) {
  const target = deps.consoles.current();
  const conn = target ? deps.manager.get(target.connection) : undefined;
  const who = target && ownerOf(target, conn);
  if (!who)
    throw new Error(
      "Reconnect opens a PostgreSQL console's or table view's session: none is on screen.",
    );
  const sessions = /** @type {{ reconnect?(owner: string): Promise<string> } | undefined} */ (
    deps.consoles.sessions
  );
  if (sessions?.reconnect === undefined) throw new Error("This desk keeps no PostgreSQL sessions.");
  const line = await sessions.reconnect(who.owner);
  deps.say(line);
  return line;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "reconnect",
  commands: (deps) => ({
    "endue.database.reconnect": () => reconnect(deps),
  }),
  // The header's button beside a lost session.
  actions: (deps) => ({
    reconnectSession: () => reconnect(deps),
  }),
  styles: [new URL("./reconnect.css", import.meta.url).href],
};
