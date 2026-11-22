// The SQL problems' commands and the editor's context (PG-30, ADR 0294). The editor underlines what
// the parse worker's check finds (../../diagnose/); this answers what it checks against: for a
// PostgreSQL console on screen, the schema cache's model (only what the cache holds: nothing is
// asked of the server), the connection's search path and role for `$user` (PG-12),
// and which kinds of problems the settings turn on (the warnings and the ones turned off, ADR 0328).
// Database: list the SQL problems, next and previous step through them in the editor as F8,
// Shift+F8 and Mod+. do; fix the SQL warning at the caret applies its fix.
import { problemModel } from "../../diagnose/model.js";
import { pathOf } from "../../engines/pg-options.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {"list" | "next" | "previous" | "fix"} Step
 */

/** What the editor checks the console on screen against, or undefined for no check. */
function contextOf(/** @type {Deps} */ deps) {
  const shown = deps.consoles.current();
  if (shown?.kind !== "console") return undefined;
  const conn = deps.manager.get(shown.connection);
  if (conn?.engine !== "postgresql") return undefined;
  const settings = deps.settings();
  const names = settings.problemsNames;
  const warnings = settings.problemsWarnings;
  return {
    doc: shown.id,
    model: names || warnings ? problemModel(conn.id, deps.catalog.cache.view(conn)) : null,
    // The connection's search path and role (PG-12), else the server's default path.
    ...pathOf(conn),
    syntax: settings.problemsSyntax,
    names,
    warnings,
    off: [...settings.problemsWarningsOff],
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
    "endue.database.fix-problem": () => step(deps, "fix"),
  }),
  actions: (deps) => ({
    problemsContext: () => contextOf(deps),
  }),
  styles: [new URL("../../diagnose/diagnose.css", import.meta.url).href],
};
