// The consoles of a connection, as many as the person opens (ADR 0286): Database: new console,
// close, rename, the console list in the palette, the connection a .sql file's console runs on, and
// Database: run a .sql file (run-file.js). The consoles themselves live in consoles.js and
// console-many.js; this folder holds their commands. No DOM.

import { labelOf } from "../../console-list.js";
import { runFile } from "./run-file.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../consoles.js").Console} Console
 */

/** What a console is called, after its connection. */
const label = (/** @type {Deps} */ deps, /** @type {Console} */ c) =>
  labelOf(c, deps.manager.get(c.connection));

/** The console a command names (its name, its id or its buffer's), else the one on screen. */
function named(/** @type {Deps} */ deps, /** @type {unknown} */ ref) {
  if (typeof ref !== "string" || !ref) return undefined;
  const found = deps.consoles.find(ref);
  if (!found) throw new Error(`No console is called ${ref}.`);
  return found;
}

/** Open another console on a connection. */
async function newConsole(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const ref = typeof args.connection === "string" ? args.connection : undefined;
  const shown = deps.consoles.current();
  const conn =
    (!ref && shown?.kind === "console" ? deps.manager.get(shown.connection) : undefined) ??
    (await deps.manager.choose(ref, "Database: new console on which connection?"));
  if (!conn) throw deps.cancelled("No console opened.");
  const target = await deps.consoles.openNew(conn);
  deps.view.focus("editor");
  return label(deps, target);
}

/** Show a console: the one named, else the one picked from the list. */
async function show(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const list = deps.consoles.consoles();
  if (list.length === 0) throw new Error("No console is open: Database: open a console opens one.");
  let target = named(deps, args.console);
  if (!target) {
    const items = list.map((c) => ({
      id: c.id,
      label: label(deps, c),
      ...(c.file ? { detail: c.file.path } : c.running || c.filing ? { detail: "running" } : {}),
    }));
    const picked = await deps.pick("Database: show which console?", items);
    if (!picked) throw deps.cancelled("No console picked.");
    target = deps.consoles.find(picked);
  }
  if (!target) throw new Error("That console was closed.");
  deps.consoles.show(target.id);
  deps.view.focus("editor");
  return label(deps, target);
}

/** Name the console on screen; an empty name gives it back its connection's. */
async function rename(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const shown = deps.consoles.current();
  if (shown?.kind !== "console") throw new Error("No console is on screen.");
  const name =
    typeof args.name === "string"
      ? args.name
      : await deps.pick("Database: name this console", [], true, shown.title ?? "Reports");
  if (name === undefined) throw deps.cancelled("Not renamed.");
  const done = await deps.consoles.rename(name);
  deps.say(`Renamed: ${done}.`);
  return done;
}

/** Close a console: the one named, else the one on screen. */
async function close(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const target = named(deps, args.console);
  const done = await deps.consoles.close(target?.id);
  deps.say(`Closed ${done}.`);
  return done;
}

/** The connection the .sql file's console on screen runs on. */
async function fileConnection(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ args,
) {
  const shown = deps.consoles.current();
  if (!shown?.file) throw new Error("No .sql file's console is on screen.");
  const ref = typeof args.connection === "string" ? args.connection : undefined;
  const name = shown.file.path.slice(shown.file.path.lastIndexOf("/") + 1);
  const conn = await deps.manager.choose(ref, `Database: run ${name} on which connection?`);
  if (!conn) throw deps.cancelled("The connection stays.");
  await deps.consoles.bind(shown, conn);
  return label(deps, shown);
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "consoles",
  commands: (deps) => ({
    "endue.database.new-console": (args) => newConsole(deps, args),
    "endue.database.consoles": (args) => show(deps, args),
    "endue.database.rename-console": (args) => rename(deps, args),
    "endue.database.close-console": (args) => close(deps, args),
    "endue.database.file-connection": (args) => fileConnection(deps, args),
    "endue.database.run-file": (args) => runFile(deps, args),
  }),
};
