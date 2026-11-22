// A console's Notifications tab (PG-25, ADR 0358): Clear empties it, Export exports it as the
// result it is (features/export/), and Listen again runs LISTEN, in the console, on each channel a
// session that ended listened to: a reconnect never does it on its own (ADR 0355). The tab's
// buttons and commands; what is heard lives with the sessions (session/listen.js). No DOM.

import { ownerOf } from "../../session/owners.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {{
 *   clear(owner: string): void,
 *   model(owner: string): { channels: string[], stopped: string[] } | undefined,
 * }} Listening
 */

/** The console on screen, its connection and owner, and what its session heard. */
function here(/** @type {Deps} */ deps) {
  const target = deps.consoles.current();
  const conn = target ? deps.manager.get(target.connection) : undefined;
  const who = target?.kind === "console" ? ownerOf(target, conn) : undefined;
  const sessions = /** @type {{ listening?: Listening } | undefined} */ (deps.consoles.sessions);
  if (!target || !conn || !who || !sessions?.listening)
    throw new Error("Notifications belong to a PostgreSQL console: none is on screen.");
  return { target, conn, owner: who.owner, listening: sessions.listening };
}

/** A channel as LISTEN names it: quoted, so its case stays. */
export const quoted = (/** @type {string} */ channel) => `"${channel.replaceAll('"', '""')}"`;

function clear(/** @type {Deps} */ deps) {
  const { owner, listening } = here(deps);
  listening.clear(owner);
  deps.consoles.render();
  deps.say("Notifications cleared.");
}

async function again(/** @type {Deps} */ deps) {
  const { target, conn, owner, listening } = here(deps);
  const channels = listening.model(owner)?.stopped ?? [];
  if (!channels.length)
    throw new Error("Nothing to listen to again: no session stopped listening.");
  const sql = channels.map((c) => `LISTEN ${quoted(c)}`).join(";\n");
  const said = await deps.consoles.runIn(target, conn, sql, {});
  deps.say(String(said ?? `Listening again on ${channels.join(", ")}.`));
}

/** The Notifications tab on screen, then the result's export. */
function exportTab(/** @type {Deps} */ deps) {
  const { target } = here(deps);
  const index = target.shown?.tabs.findIndex((t) => t.kind === "notifications") ?? -1;
  if (index < 0) throw new Error("No notifications here: LISTEN on a channel first.");
  deps.consoles.tab(index);
  return deps.commands.run("endue.database.export");
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "notifications",
  commands: (deps) => ({
    "endue.database.clear-notifications": () => clear(deps),
    "endue.database.export-notifications": () => exportTab(deps),
    "endue.database.listen-again": () => again(deps),
  }),
  // The tab's buttons.
  actions: (deps) => ({
    clearNotifications: () => clear(deps),
    exportNotifications: () => exportTab(deps),
    listenAgain: () => again(deps),
  }),
};
