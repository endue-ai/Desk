// Switching databases (PG-13, ADR 0321): Database: switch the database moves the console or the
// table view on screen to another database of its PostgreSQL connection's server, picked from the
// ones the explorer lists (the connection's own first) or named, which reads nothing: a database
// that is not there says so at the next run. A console keeps its id and its
// text, and its next run goes there; a table view reads the same table there. Pending changes in
// the grid are asked about first. The header's database button calls the same action.

import { homeOf, onDatabase, ownDatabase } from "../../databases.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 */

/** Pick one of the server's databases, the connection's own first and the one it is on ticked. */
async function ask(
  /** @type {Deps} */ deps,
  /** @type {import("../../engines/common.js").Connection} */ home,
  /** @type {string} */ here,
) {
  const own = ownDatabase(home);
  const others = (await deps.catalog.databases(home)).map((d) => d.name).filter((n) => n !== own);
  return deps.pick(
    t("features.databases.index.databaseMoveItToWhichDatabase", { name: String(home.name) }),
    [own, ...others].map((name) => ({
      id: name,
      label: `${name === here ? "✓ " : ""}${name}`,
      detail: name === own ? t("features.databases.index.theConnectionS") : "",
    })),
  );
}

/** Move the buffer on screen to the database named (read nothing), or to the one picked. */
async function switchTo(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const shown = deps.consoles.current();
  if (shown?.kind !== "console" && shown?.kind !== "table")
    throw new Error(t("features.databases.index.openAConsoleOrATable"));
  const conn = deps.manager.get(shown.connection);
  if (!conn) throw new Error(t("features.databases.index.thisConsoleHasNoConnectionYet"));
  if (conn.engine !== "postgresql")
    throw new Error(
      t("features.databases.index.isNotPostgresqlItsDatabasesAre", { name: String(conn.name) }),
    );
  const home = homeOf(conn);
  const here = ownDatabase(conn);
  const picked =
    typeof args.database === "string" && args.database
      ? args.database
      : await ask(deps, home, here);
  if (picked === undefined) return undefined;
  if (picked !== here) await deps.consoles.rebind(shown, onDatabase(home, picked));
  deps.say(t("features.databases.index.onOf", { picked: String(picked), name: String(home.name) }));
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
