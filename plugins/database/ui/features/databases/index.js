// Switching databases (PG-13, ADR 0321): Database: switch the database moves the console or the
// table view on screen to another database of its PostgreSQL connection's server, picked from the
// ones the explorer lists (the connection's own first) or named. A console keeps its id and its
// text, and its next run goes there; a table view reads the same table there. Pending changes in
// the grid are asked about first. The header's database button calls the same action.

import { homeOf, onDatabase, ownDatabase } from "../../databases.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 */

/** Move the buffer on screen to the database named, or to the one the person picks. */
async function switchTo(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const shown = deps.consoles.current();
  if (shown?.kind !== "console" && shown?.kind !== "table")
    throw new Error("Open a console or a table first: they run on a database.");
  const conn = deps.manager.get(shown.connection);
  if (!conn) throw new Error("This console has no connection yet: run it to pick one.");
  if (conn.engine !== "postgresql")
    throw new Error(`${conn.name} is not PostgreSQL: its databases are the explorer's schemas.`);
  const home = homeOf(conn);
  const own = ownDatabase(home);
  const here = ownDatabase(conn);
  const others = (await deps.catalog.databases(home)).map((d) => d.name).filter((n) => n !== own);
  const picked =
    typeof args.database === "string" && args.database
      ? args.database
      : await deps.pick(
          `Database: move it to which database of ${home.name}?`,
          [own, ...others].map((name) => ({
            id: name,
            label: `${name === here ? "✓ " : ""}${name}`,
            detail: name === own ? "the connection's" : "",
          })),
        );
  if (picked === undefined) return undefined;
  if (picked !== here) await deps.consoles.rebind(shown, onDatabase(home, picked));
  deps.say(`On ${picked} of ${home.name}.`);
  return picked;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "databases",
  commands: (deps) => ({
    "endue.database.switch-database": (args) => switchTo(deps, args),
  }),
  actions: (deps) => ({
    switchDatabase: () => switchTo(deps, {}),
  }),
};
