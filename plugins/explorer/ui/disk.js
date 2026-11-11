// The explorer's side of the bridge's fs namespace: a listing, an empty new file, a new folder, a
// rename, a trash, and watches on folders, each under a scope that covers the folder the path belongs
// to. When the grants do not cover a path, the person is asked once for its folder (perm.request) and
// the call is tried again. Every failure is an Error whose message is the sentence the person reads
// (the bridge's code in words), with the bridge's error code as `code` and a few words for a row as
// `brief`.
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

/** What a bridge error code means, said after "Could not list ~/x: ". */
const WORDS = /** @type {Record<string, string>} */ ({
  not_found: "it is not there",
  already_exists: "something by that name is already there",
  io_error: "the disk answered with an error",
  timeout: "the desk did not answer in time",
  unsupported: "this desk cannot do that",
  invalid_params: "the desk does not take that path",
  cancelled: "it was stopped",
  internal: "something went wrong in the desk",
});
/** The same, in a few words for a folder's row. */
const BRIEF = /** @type {Record<string, string>} */ ({
  not_found: "not there",
  permission_denied: "not allowed",
});

/** An Error the person reads, with the bridge's code and the row's few words. */
const failure = (
  /** @type {string} */ text,
  /** @type {string} */ code,
  /** @type {string} */ verb,
) => Object.assign(new Error(text), { code, brief: BRIEF[code] ?? `could not ${verb}` });

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
    const refused = failure(`Not allowed to ${verb} ${path}.`, "permission_denied", verb);
    const failed = (/** @type {unknown} */ error) => {
      const code = codeOf(error);
      if (code === "permission_denied") return refused;
      return failure(`Could not ${verb} ${path}: ${WORDS[code] ?? "it failed"}.`, code, verb);
    };
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

    /** Read a bounded preview under the same folder grant as the listing. */
    read: (/** @type {string} */ path, /** @type {number} */ length) =>
      withGrant(
        { permission: "fs:read", verb: "read", path, reason: `To preview ${path} in ${NAME}` },
        (scope) => bridge.call("fs.read", { path, offset: 0, length, encoding: "base64", scope }),
      ),

    /**
     * A URL the frame loads an image preview from, under the same folder grant: the bytes never pass
     * through the bridge or this thread, and the engine decodes them (ADR 0041, #38).
     */
    url: (/** @type {string} */ path) =>
      withGrant(
        { permission: "fs:read", verb: "read", path, reason: `To preview ${path} in ${NAME}` },
        (scope) => bridge.call("fs.url", { path, scope }),
      ),

    /** Create an empty file. The caller makes sure nothing is there first. */
    create: (/** @type {string} */ path) =>
      withGrant(
        { permission: "fs:write", verb: "write", path, reason: `To create ${path}` },
        (scope) => bridge.call("fs.write", { path, content: "", encoding: "utf8", scope }),
      ),

    /** Make one folder; a name already taken is the core's already_exists, never an overwrite. */
    mkdir: (/** @type {string} */ path) =>
      withGrant(
        { permission: "fs:write", verb: "create", path, reason: `To create ${path}` },
        (scope) => bridge.call("fs.mkdir", { path, scope }),
      ),

    /** Give an entry a new name in its folder. One fs.rename, which the desk's undo reverses. */
    rename: (/** @type {string} */ from, /** @type {string} */ to) =>
      withGrant(
        { permission: "fs:write", verb: "rename", path: from, reason: `To rename ${from}` },
        (scope) => bridge.call("fs.rename", { from, to, scope }),
      ),

    /** Move an entry to the OS trash; where there is none the core answers unsupported. */
    trash: (/** @type {string} */ path) =>
      withGrant(
        { permission: "fs:write", verb: "trash", path, reason: `To move ${path} to the Trash` },
        (scope) => bridge.call("fs.trash", { path, scope }),
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
