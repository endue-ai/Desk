// The plugin's file access: ranged fs.read calls as base64 (asking once with perm.request for the
// file's folder when its grants do not cover it), fs.watch, and the scopes extraction writes under.
// Every failure is an Error whose message is the sentence the person reads.
import { fromBase64 } from "./bytes.js";
import { cachedSource } from "./source.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext["bridge"]} Bridge
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 */

/** The folder a file is in. @param {string} path */
export const folderOf = (path) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? path : path.slice(0, slash);
};
/** @param {string} path */
export const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1);

/** @param {"fs:read" | "fs:write"} permission @param {string} folder */
export function scopeUnder(permission, folder) {
  const paths = [`${folder}/**`];
  return { permission, paths };
}

export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** @param {Bridge} bridge */
export function createFiles(bridge) {
  /**
   * Ask once for `scope`; true when the person allows it.
   * @param {Permission} scope @param {string} reason
   */
  const ask = async (scope, reason) => {
    const decision = await bridge
      .call("perm.request", { permission: scope, reason })
      .catch(() => ({ granted: false }));
    return decision.granted === true;
  };

  /**
   * Open `path` for ranged reads. Throws "Not allowed to read <path>." when refused.
   * @param {string} path
   */
  const open = async (path) => {
    const scope = /** @type {const} */ (scopeUnder("fs:read", folderOf(path)));
    const refused = new Error(`Not allowed to read ${path}.`);
    /** @param {unknown} error */
    const failed = (error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${path}: ${codeOf(error)}.`);
    /** @param {number} offset @param {number} length */
    const read = (offset, length) =>
      bridge.call("fs.read", { path, encoding: "base64", offset, length, scope });
    let first;
    try {
      first = await read(0, 0);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
      if (!(await ask(scope, `To open ${path} in Archives`))) throw refused;
      first = await read(0, 0).catch((e) => Promise.reject(failed(e)));
    }
    const size = first.size ?? 0;
    const source = cachedSource(async (offset, length) => {
      try {
        return fromBase64((await read(offset, length)).content);
      } catch (error) {
        throw failed(error);
      }
    }, size);
    return { source, size, scope };
  };

  /** Follow the file; undefined when it cannot be watched. @param {string} path */
  const watch = (path) =>
    bridge
      .call("fs.watch", { path, scope: scopeUnder("fs:read", folderOf(path)) })
      .then(({ watchId }) => watchId)
      .catch(() => undefined);

  return { open, watch, ask };
}
