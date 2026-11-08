// The calendar plugin's files: the desk's file and buffer requests (desk.files.visit, .save, .revert,
// desk.buffers.show, .closed) for the iCalendar files it holds, fs.read and fs.write under the
// plugin's grants (asking once with perm.request for a folder they do not cover), a watch on each
// open file, and the unsaved mark the desk shows. Like the notes plugin, a save of an unchanged
// calendar writes the file exactly as it was read.
import { formatComponent } from "./ical/component.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./calendar.js").Cal} Cal
 * @typedef {"fs:read" | "fs:write"} FsPermission
 *
 * @typedef {object} Core what the files share with the rest of the plugin
 * @property {Map<string, Cal>} calendars open calendars by buffer
 * @property {() => string | null} shown the buffer on screen
 * @property {(buffer: string | null) => void} show put a buffer on screen (null: none) and draw
 * @property {() => void} render
 * @property {(cal: Cal, text: string) => void} load
 * @property {(cal: Cal) => Cal} writable
 * @property {(buffer: string) => void} closed the buffer went: forget what refers to it
 * @property {(name: string, handler: (args: unknown) => unknown) => void} answer
 */

export const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/"))) || path;
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const scopeOf = (/** @type {FsPermission} */ permission, /** @type {string} */ path) => ({
  permission,
  paths: [`${folderOf(path)}/**`],
});

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {Core} core
 */
export function createFiles({ bridge, commands }, core) {
  const { calendars } = core;
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();

  const held = (/** @type {string} */ buffer) => {
    const cal = calendars.get(buffer);
    if (!cal) throw new Error(`No calendar ${buffer}.`);
    return cal;
  };

  /**
   * One fs call; when the grants do not cover the file, ask once for its folder and try again.
   * Every failure is an Error whose message is the sentence the person reads.
   * @template T
   * @param {FsPermission} permission
   * @param {string} path
   * @param {(scope: { permission: FsPermission, paths: string[] }) => Promise<T>} call
   * @returns {Promise<T>}
   */
  const withGrant = async (permission, path, call) => {
    const verb = permission === "fs:read" ? "read" : "write";
    const scope = scopeOf(permission, path);
    const refused = new Error(`Not allowed to ${verb} ${path}.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not ${verb} ${path}: ${codeOf(error)}.`);
    try {
      return await call(scope);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    const reason = verb === "read" ? `To open ${path} in Calendar` : `To save ${path}`;
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", { permission: /** @type {Permission} */ (scope), reason })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call(scope);
    } catch (error) {
      throw failed(error);
    }
  };

  /** Read a file; a missing one fails with a message that ends "not_found.". */
  const read = async (/** @type {string} */ path) =>
    (
      await withGrant("fs:read", path, (scope) =>
        bridge.call("fs.read", { path, encoding: "utf8", scope: /** @type {never} */ (scope) }),
      )
    ).content;

  const write = (/** @type {string} */ path, /** @type {string} */ content, createDirs = false) =>
    withGrant("fs:write", path, (scope) =>
      bridge.call("fs.write", {
        path,
        content,
        encoding: "utf8",
        ...(createDirs ? { createDirs } : {}),
        scope: /** @type {never} */ (scope),
      }),
    );

  /** Follow the file on disk. Without a watch the calendar still works; changes go unnoticed. */
  const watch = async (/** @type {Cal} */ cal) => {
    const scope = /** @type {never} */ (scopeOf("fs:read", cal.path));
    await bridge.call("fs.watch", { path: cal.path, scope }).then(
      ({ watchId }) => {
        if (calendars.get(cal.buffer) !== cal) return;
        cal.watchId = watchId;
        watches.set(watchId, cal.buffer);
      },
      () => {},
    );
  };

  /** desk.buffers.update runs once per change from saved to unsaved, not on every edit. */
  const report = (/** @type {Cal} */ cal) => {
    if (!cal.modified || cal.reported || calendars.get(cal.buffer) !== cal) return;
    cal.reported = true;
    commands.run("desk.buffers.update", { id: cal.buffer, modified: true }).catch(() => {});
  };

  const forget = (/** @type {string} */ buffer) => {
    const cal = calendars.get(buffer);
    if (cal?.watchId) watches.delete(cal.watchId);
    calendars.delete(buffer);
  };

  core.answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const text = await read(path);
    forget(buffer);
    const cal = /** @type {Cal} */ ({ buffer, path, name: nameOf(path), modified: false });
    cal.reported = false;
    core.load(cal, text);
    calendars.set(buffer, cal);
    core.show(buffer);
    await watch(cal);
  });

  core.answer("desk.files.save", async (args) => {
    const { buffer, path: asked } = requested(args);
    const cal = core.writable(held(buffer));
    const path = asked ?? cal.path;
    const doc = cal.doc;
    const content = cal.modified ? doc.calendars.map(formatComponent).join("") : cal.text;
    await write(path, content);
    cal.text = content;
    cal.reported = false;
    // A change made while the file was written stays unsaved, and the desk hears so again.
    cal.modified = cal.doc !== doc;
    if (core.shown() === buffer) core.render();
    if (cal.modified) setTimeout(() => report(cal), 0);
  });

  core.answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const cal = held(buffer);
    core.load(cal, await read(asked ?? cal.path));
    cal.modified = false;
    cal.reported = false;
    if (core.shown() === buffer) core.render();
  });

  core.answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    core.show(buffer);
  });

  core.answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    forget(buffer);
    core.closed(buffer);
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    if (core.shown() === buffer) core.show(null);
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const cal = buffer === undefined ? undefined : calendars.get(buffer);
    // Every change, the one a save causes included: desk.files.on-change decides what happens.
    if (cal) commands.run("desk.files.changed", { path: cal.path }).catch(() => {});
  });

  return { read, write, report };
}
