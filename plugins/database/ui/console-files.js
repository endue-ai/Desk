// A .sql file is a console bound to it (ADR 0286). The desk opens `*.sql` with the plugin
// (desk.files.visit), and a dropped one opens in a buffer of the plugin's that names its path, so
// either way the desk lists, saves (desk.files.save) and reverts it as a file. It runs on the
// connection the file remembers (store `sql-files`, the last 200 files), else for a drop the
// console on screen's, else the person's pick, else none until a run asks. An edit marks the buffer
// unsaved; Save writes that file and no other, asking with perm.request where the grants do not
// reach (ADR 0131 grants reads only, ADR 0260); a change on disk goes to the desk
// (desk.files.changed), whose desk.files.on-change asks before unsaved edits are replaced. A file
// past the editor's limit opens without its text: Run file runs it from disk. With format on save
// (`format`, ADR 0292) Save lays the console out first, as Format SQL would. No DOM.

import { baseName } from "./console-list.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {{ permission: "fs:read" | "fs:write", paths: string[] }} FsScope
 * @typedef {{ content: string, size?: number }} Head
 *   A file's text as read up to the editor's limit, and its whole size in bytes when known.
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">,
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   manager: { get(id: string): Connection | undefined,
 *     choose(ref: string | undefined, title: string): Promise<Connection | undefined> },
 *   consoles: Pick<ReturnType<typeof import("./consoles.js").createConsoles>,
 *     "openFile" | "find" | "consoles" | "current" | "render">,
 *   view: { editor(): { text: string }, replace(start: number, end: number, text: string): void },
 *   format?(target: Console): Promise<{ from: number, to: number, text: string } | undefined>,
 * }} Deps
 *   `format` lays a console out before Save, or answers undefined when Save writes it as typed.
 */

/** The largest file a console loads into its editor, in bytes. */
export const EDITOR_MAX = 1024 * 1024;
const FILES_KEY = "sql-files";
const REMEMBERED = 200;
const STORE_ROOM = 60 * 1024;

/** @returns {FsScope} */
export const readScope = (/** @type {string} */ path) => ({ permission: "fs:read", paths: [path] });
/** @returns {FsScope} */
export const writeScope = (/** @type {string} */ path) => ({
  permission: "fs:write",
  paths: [path],
});
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const bytesOf = (/** @type {string} */ text) => new TextEncoder().encode(text).length;
/** A size as the person reads it: `512 KiB`, `1 MiB`, `3.2 MiB`. */
export const sizeText = (/** @type {number} */ bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KiB`
    : `${Number((bytes / 1024 / 1024).toFixed(1))} MiB`;

/**
 * One fs call on a file under the plugin's grants; refused, ask once for that file and call again.
 * Every failure is an Error whose message is the sentence the person reads.
 * @template T
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {FsScope} scope
 * @param {() => Promise<T>} call
 * @param {string} reason
 * @returns {Promise<T>}
 */
export async function withGrant(bridge, scope, call, reason) {
  const name = baseName(scope.paths[0] ?? "");
  const verb = scope.permission === "fs:read" ? "read" : "write";
  try {
    return await call();
  } catch (error) {
    if (codeOf(error) !== "permission_denied")
      throw new Error(
        t("consoleFiles.couldNot", {
          verb: String(verb),
          name: String(name),
          value: String(codeOf(error)),
        }),
      );
  }
  const decision = await bridge
    .call("perm.request", { permission: scope, reason })
    .catch(() => ({ granted: false }));
  if (!decision.granted)
    throw new Error(t("consoleFiles.notAllowedTo", { verb: String(verb), name: String(name) }));
  return call().catch((again) => {
    throw new Error(
      t("consoleFiles.couldNot", {
        verb: String(verb),
        name: String(name),
        value: String(codeOf(again)),
      }),
    );
  });
}

/** What the editor of a file past its limit holds instead of the file. */
const noteOf = (/** @type {string} */ path, /** @type {number} */ size) =>
  `-- ${baseName(path)} is ${sizeText(size)}, larger than the editor's ${sizeText(EDITOR_MAX)}: it is not loaded here.\n` +
  "-- Database: run a .sql file runs it from disk, statement by statement.\n";

/** @param {Deps} deps */
export function createConsoleFiles(deps) {
  const { bridge, commands, consoles } = deps;
  /** The file each watch follows, by its id. @type {Map<string, string>} */
  const watches = new Map();
  let local = 0;

  /** @returns {Promise<Array<{ path: string, connection: string }>>} */
  const remembered = async () => {
    const kept = await bridge.call("store.get", { key: FILES_KEY }).catch(() => ({}));
    const list = Array.isArray(kept.value) ? kept.value : [];
    return list.filter((e) => typeof e?.path === "string" && typeof e?.connection === "string");
  };
  const remember = async (/** @type {string} */ path, /** @type {string} */ connection) => {
    let list = [{ path, connection }, ...(await remembered()).filter((e) => e.path !== path)];
    list = list.slice(0, REMEMBERED);
    while (list.length > 1 && JSON.stringify(list).length > STORE_ROOM) list = list.slice(0, -1);
    await bridge.call("store.set", { key: FILES_KEY, value: list }).catch(() => {});
  };

  /** A file's text up to the editor's limit, and its size. @returns {Promise<Head>} */
  const read = async (/** @type {string} */ path) => {
    const scope = readScope(path);
    const call = () =>
      bridge.call("fs.read", { path, encoding: "utf8", length: EDITOR_MAX, scope });
    return withGrant(bridge, scope, call, `To open ${baseName(path)} in Database`);
  };
  /** The binding a head of a file gives: its text, or a note when it is past the limit. */
  const loaded = (/** @type {string} */ path, /** @type {Head} */ head) => {
    const size = head.size ?? bytesOf(head.content);
    const large = size > EDITOR_MAX;
    return {
      text: large ? noteOf(path, size) : head.content,
      file: { path, saved: large ? "" : head.content, modified: false, large, size },
    };
  };

  /** The connection a file runs on: the one it remembers, else `near`, else the person's pick. */
  const connectionFor = async (
    /** @type {string} */ path,
    /** @type {Connection | undefined} */ near,
  ) => {
    const kept = (await remembered()).find((e) => e.path === path);
    const known = kept ? deps.manager.get(kept.connection) : undefined;
    if (known) return known;
    const title = t("consoleFiles.databaseRunOnWhichConnection", { value: String(baseName(path)) });
    const conn = near ?? (await deps.manager.choose(undefined, title).catch(() => undefined));
    if (conn) await remember(path, conn.id);
    return conn;
  };

  const watch = async (/** @type {string} */ path) => {
    const done = await bridge
      .call("fs.watch", { path, scope: readScope(path) })
      .catch(() => undefined);
    if (done) watches.set(done.watchId, path);
  };
  bridge.onEvent((event) => {
    if (event.event !== "fs.changed") return;
    const path = watches.get(event.data.watchId);
    if (!path) return;
    if (!consoles.consoles().some((c) => c.file?.path === path)) {
      watches.delete(event.data.watchId);
      return;
    }
    // The desk asks before unsaved edits are replaced (desk.files.on-change), then reverts.
    void commands.run("desk.files.changed", { path }).catch(() => {});
  });

  /** A file's console in `buffer`. */
  const openIn = async (
    /** @type {string} */ buffer,
    /** @type {string} */ path,
    /** @type {Head} */ head,
    /** @type {Connection | undefined} */ near,
  ) => {
    const conn = await connectionFor(path, near);
    const target = consoles.openFile({ buffer, conn, ...loaded(path, head) });
    await watch(path);
    return target;
  };

  /** The console a desk request names, when it is a bound file's. */
  const fileConsole = (/** @type {string} */ buffer) => {
    const target = consoles.find(buffer);
    return target?.id === buffer && target.file ? target : undefined;
  };
  /** Say the console's text is saved or not, to the desk and on screen, once per change. */
  const mark = (/** @type {Console} */ target, /** @type {boolean} */ modified) => {
    if (!target.file || target.file.modified === modified) return;
    target.file.modified = modified;
    void commands.run("desk.buffers.update", { id: target.id, modified }).catch(() => {});
    consoles.render();
  };

  /** Format on save: the console laid out first, in its editor when on screen (undoable there). A
   * failure, or an edit meanwhile, keeps the text as typed, and the save goes on. */
  const laidOut = async (/** @type {Console} */ target) => {
    const before = target.text;
    const laid = await deps.format?.(target).catch(() => undefined);
    if (!laid || target.text !== before) return;
    const next = before.slice(0, laid.from) + laid.text + before.slice(laid.to);
    if (next === before) return;
    if (consoles.current() === target) {
      if (deps.view.editor().text !== before) return;
      deps.view.replace(laid.from, laid.to, laid.text);
    }
    target.text = next;
  };

  return {
    /** The desk opened a .sql file with the plugin, in its buffer. */
    visit: async (/** @type {string} */ buffer, /** @type {string} */ path) =>
      openIn(buffer, path, await read(path), undefined),
    /** A dropped .sql file (its head read by dropped.js): its console, in a buffer naming it. */
    async open(
      /** @type {string} */ path,
      /** @type {Head} */ head,
      /** @type {Connection | undefined} */ near,
    ) {
      const open = consoles.consoles().find((c) => c.file?.path === path);
      if (open)
        return consoles.openFile({ buffer: open.id, conn: undefined, ...loaded(path, head) });
      const given = await commands
        .run("desk.buffers.open", { name: baseName(path), path })
        .catch(() => undefined);
      const buffer = typeof given === "string" ? given : `local-file-${++local}`;
      return openIn(buffer, path, head, near);
    },
    /** The desk saves a buffer: a bound file's console writes its text to that file only. */
    async save(/** @type {string} */ buffer) {
      const target = fileConsole(buffer);
      if (!target?.file) return false;
      const { path, large } = target.file;
      const name = baseName(path);
      if (large)
        throw new Error(
          t("consoleFiles.isLargerThanTheEditorS", {
            name: String(name),
            value: String(sizeText(EDITOR_MAX)),
          }),
        );
      await laidOut(target);
      const text = target.text;
      const scope = writeScope(path);
      const call = () => bridge.call("fs.write", { path, content: text, encoding: "utf8", scope });
      await withGrant(bridge, scope, call, `To save ${name} from Database`);
      target.file.saved = text;
      mark(target, target.text !== text);
      return true;
    },
    /** The desk reverts a buffer (or a change on disk replaces it): read the file again. */
    async revert(/** @type {string} */ buffer) {
      const target = fileConsole(buffer);
      if (!target?.file) return false;
      const next = loaded(target.file.path, await read(target.file.path));
      target.file = { ...next.file, modified: target.file.modified };
      if (consoles.current() === target) {
        // Past the person's typing too: the editor takes the text the file holds now.
        deps.view.replace(0, deps.view.editor().text.length, next.text);
      }
      target.text = next.text;
      mark(target, false);
      consoles.render();
      return true;
    },
    /** A bound file's console was edited: mark it unsaved, or saved again. */
    edited(/** @type {Console} */ target) {
      if (target.file && !target.file.large) mark(target, target.text !== target.file.saved);
    },
    remember,
  };
}
