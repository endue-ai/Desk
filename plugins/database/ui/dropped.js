// Carrying a drop out (drops.js says what it is): SQL goes into the console on screen, or the
// console of a connection the person picks; a .sql file opens as a console bound to it
// (console-files.js), on the connection of the console on screen unless the file remembers one; a
// .sql, .csv, .tsv or .json file is read with fs.read under the plugin's own grant, asked for once
// with perm.request (a drop hands over the path, not access to it), a .sql file only up to the
// editor's limit; a SQLite file opens as a connection. No DOM.

import { EDITOR_MAX, readScope, withGrant } from "./console-files.js";
import { dropAction } from "./drops.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./drops.js").Dropped} Dropped
 * @typedef {import("./importer.js").Into} Into
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   manager: { get(id: string): Connection | undefined,
 *     choose(ref: string | undefined, title: string): Promise<Connection | undefined> },
 *   consoles: { current(): { kind: string, connection: string } | null,
 *     open(conn: Connection): Promise<unknown> },
 *   importer: { start(input: { path: string, text: string, format: import("./import.js").Format,
 *     into?: Into }): Promise<void> },
 *   files: { open(path: string, head: import("./console-files.js").Head,
 *     near: Connection | undefined): Promise<unknown> },
 *   view: { insert(text: string): void, focus(where: "editor"): void },
 *   visit(buffer: string, path: string): Promise<void>,
 * }} Deps
 */

/** The largest file a drop reads. */
const MAX_BYTES = 16 * 1024 * 1024;

/** @param {Deps} deps */
export function createDropped(deps) {
  /**
   * A dropped file, read under its own scope (refused, asked once and read again), whole or its
   * first `length` bytes.
   * @param {string} path
   * @param {number} [length]
   */
  const read = async (path, length) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const scope = readScope(path);
    const call = () =>
      deps.bridge.call("fs.read", {
        path,
        encoding: "utf8",
        scope,
        ...(length === undefined ? {} : { length }),
      });
    const file = await withGrant(deps.bridge, scope, call, `To open ${name} in Database`);
    if (length === undefined && file.content.length > MAX_BYTES)
      throw new Error(`${name} is larger than ${MAX_BYTES / 1024 / 1024} MiB.`);
    return file;
  };
  /** The connection of the console on screen. */
  const here = () => {
    const shown = deps.consoles.current();
    return shown?.kind === "console" ? deps.manager.get(shown.connection) : undefined;
  };

  /** The console the SQL goes into: the one on screen, else the console of one picked. */
  const consoleFor = async () => {
    const on = here();
    if (on) return on;
    const conn = await deps.manager.choose(undefined, "Database: open the SQL in which console?");
    if (!conn) return undefined;
    await deps.consoles.open(conn);
    deps.view.focus("editor");
    return conn;
  };

  /** Put SQL in a console; false when the person picked none. */
  const insert = async (/** @type {string} */ text) => {
    if (!(await consoleFor())) return false;
    deps.view.insert(text);
    return true;
  };

  /**
   * Carry out a drop: undefined when it was (the effect agreed), "none" when nothing was done;
   * a refusal throws the sentence to say.
   * @param {Dropped} item
   * @param {Into} [into] The explorer table it landed on, for an import.
   */
  return async (item, into) => {
    const action = dropAction(item);
    switch (action.kind) {
      case "visit":
        await deps.visit(`file:${action.path}`, action.path);
        return undefined;
      case "insert":
        return (await insert(action.text)) ? undefined : "none";
      case "sql": {
        const head =
          action.text === undefined
            ? await read(action.path, EDITOR_MAX)
            : { content: action.text };
        await deps.files.open(action.path, head, here());
        deps.view.focus("editor");
        return undefined;
      }
      case "import": {
        const { content: text } = await read(action.path);
        await deps.importer.start({
          path: action.path,
          text,
          format: action.format,
          ...(into ? { into } : {}),
        });
        return undefined;
      }
      default:
        throw new Error(action.reason);
    }
  };
}
