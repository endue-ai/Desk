// The SQL problems' commands and the editor's context (PG-30, ADR 0294). The editor underlines what
// the parse worker's check finds (../../diagnose/); this answers what it checks against: for a
// PostgreSQL console on screen, the schema cache's model (only what the cache holds: nothing is
// asked of the server), the search path the server starts with, the connection's user for `$user`,
// and which kinds of problems the settings turn on. Database: list the SQL problems, next and
// previous step through them in the editor as F8, Shift+F8 and Mod+. do.
import { problemModel } from "../../diagnose/model.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {"list" | "next" | "previous"} Step
 */

/** The server's default search path; a role's or a database's own is not known until a session says. */
const SEARCH_PATH = ["$user", "public"];

/** What the editor checks the console on screen against, or undefined for no check. */
function contextOf(/** @type {Deps} */ deps) {
  const shown = deps.consoles.current();
  if (shown?.kind !== "console") return undefined;
  const conn = deps.manager.get(shown.connection);
  if (conn?.engine !== "postgresql") return undefined;
  const settings = deps.settings();
  const names = settings.problemsNames;
  return {
    doc: shown.id,
    model: names ? problemModel(conn.id, deps.catalog.cache.view(conn)) : null,
    searchPath: [...SEARCH_PATH],
    user: conn.user,
    syntax: settings.problemsSyntax,
    names,
  };
}

/** A step through the problems in the editor on screen. */
function step(/** @type {Deps} */ deps, /** @type {Step} */ what) {
  const view = /** @type {{ problems?(what: Step): boolean }} */ (
    /** @type {unknown} */ (deps.view)
  );
  if (!view.problems?.(what)) deps.say("Open a PostgreSQL console to see its SQL problems.");
  return undefined;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "problems",
  commands: (deps) => ({
    "endue.database.problems": () => step(deps, "list"),
    "endue.database.next-problem": () => step(deps, "next"),
    "endue.database.previous-problem": () => step(deps, "previous"),
  }),
  actions: (deps) => ({
    problemsContext: () => contextOf(deps),
  }),
  styles: [new URL("../../diagnose/diagnose.css", import.meta.url).href],
};
