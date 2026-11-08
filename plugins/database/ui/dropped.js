// Carrying a drop out (drops.js says what it is): SQL goes into the console on screen, or the
// console of a connection the person picks; a .sql, .csv, .tsv or .json file is read with fs.read
// under the plugin's own grant, asked for once with perm.request (a drop hands over the path, not
// access to it); a SQLite file opens as a connection. No DOM.

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
 *   view: { insert(text: string): void, focus(where: "editor"): void },
 *   visit(buffer: string, path: string): Promise<void>,
 * }} Deps
 */

/** The largest file a drop reads. */
const MAX_BYTES = 16 * 1024 * 1024;
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** @param {Deps} deps */
export function createDropped(deps) {
  /** A dropped file's text, read under its own scope; refused, ask once and read again. */
  const read = async (/** @type {string} */ path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const scope = { permission: /** @type {const} */ ("fs:read"), paths: [path] };
    const call = () => deps.bridge.call("fs.read", { path, encoding: "utf8", scope });
    /** @type {{ content: string }} */
    let file;
    try {
      file = await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied")
        throw new Error(`Could not read ${name}: ${codeOf(error)}.`);
      const decision = await deps.bridge
        .call("perm.request", { permission: scope, reason: `To open ${name} in Database` })
        .catch(() => ({ granted: false }));
      if (!decision.granted) throw new Error(`Not allowed to read ${name}.`);
      file = await call().catch((again) => {
        throw new Error(`Could not read ${name}: ${codeOf(again)}.`);
      });
    }
    if (file.content.length > MAX_BYTES)
      throw new Error(`${name} is larger than ${MAX_BYTES / 1024 / 1024} MiB.`);
    return file.content;
  };

  /** The console the SQL goes into: the one on screen, else the console of one picked. */
  const consoleFor = async () => {
    const shown = deps.consoles.current();
    const here = shown?.kind === "console" ? deps.manager.get(shown.connection) : undefined;
    if (here) return here;
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
      case "console":
        return (await insert(await read(action.path))) ? undefined : "none";
      case "import": {
        const text = await read(action.path);
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
