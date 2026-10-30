// The explorer's side of the bridge's fs namespace: a listing, an empty new file, and watches on
// folders, each under a scope that covers the folder the path belongs to. When the grants do not
// cover a path, the person is asked once for its folder (perm.request) and the call is tried again.
// Every failure is an Error whose message is the sentence the person reads.
import { parentOf, patternOf } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").DirEntry} DirEntry
 * @typedef {"fs:read" | "fs:write"} FsPermission
 * @typedef {{ permission: FsPermission, paths: string[] }} FsScope
 */

/** fs.watch has no unwatch in bridge v0, so watches are capped; later folders refresh on expand. */
export const WATCH_LIMIT = 64;
const NAME = "the explorer";

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * @param {PluginContext["bridge"]} bridge
 * @param {{ rootOf(path: string): string | undefined, changed(folder: string): void }} deps
 * `rootOf` names the explorer folder a path is under; `changed` hears a watched folder change.
 */
export function createDisk(bridge, { rootOf, changed }) {
  /** Watch id -> the folder it follows, and folder -> watch id ("" while asked). */
  const watches = new Map();
  const watched = new Map();

  /** The scope an fs call carries: everything under the folder the path belongs to. */
  const scopeOf = (/** @type {FsPermission} */ permission, /** @type {string} */ path) => ({
    permission,
    paths: [patternOf(rootOf(path) ?? parentOf(path) ?? path)],
  });

  /**
   * @template T
   * @param {{ permission: FsPermission, verb: string, path: string, reason: string }} what
   * @param {(scope: FsScope) => Promise<T>} call
   * @returns {Promise<T>}
   */
  const withGrant = async ({ permission, verb, path, reason }, call) => {
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
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", { permission: scope, reason })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call(scope);
    } catch (error) {
      throw failed(error);
    }
  };

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const folder = watches.get(event.data.watchId);
    if (folder !== undefined) changed(folder);
  });

  return {
    /** The entries of one folder. @returns {Promise<DirEntry[]>} */
    list: async (/** @type {string} */ path) =>
      (
        await withGrant(
          { permission: "fs:read", verb: "list", path, reason: `To show ${path} in ${NAME}` },
          (scope) => bridge.call("fs.list", { path, scope }),
        )
      ).entries,

    /** Create an empty file. The caller makes sure nothing is there first. */
    create: (/** @type {string} */ path) =>
      withGrant(
        { permission: "fs:write", verb: "write", path, reason: `To create ${path}` },
        (scope) => bridge.call("fs.write", { path, content: "", encoding: "utf8", scope }),
      ),

    /** Follow a folder on disk. Without a watch it still works; changes just go unnoticed. */
    watch: async (/** @type {string} */ path) => {
      if (watched.has(path) || watched.size >= WATCH_LIMIT) return;
      watched.set(path, "");
      try {
        const { watchId } = await bridge.call("fs.watch", {
          path,
          scope: scopeOf("fs:read", path),
        });
        watched.set(path, watchId);
        watches.set(watchId, path);
      } catch {
        watched.delete(path);
      }
    },
  };
}
