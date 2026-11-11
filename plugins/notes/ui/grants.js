// Notes' file calls under its grants: notes ask for, and work under, whole folders. A call the grants
// do not cover asks once for the file's folder (perm.request) and tries again; every failure is an
// Error whose message is the sentence the person reads. A quiet read never asks.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {"fs:read" | "fs:write"} FsPermission
 */

/**
 * The scope an fs call carries, as the manifest's permissions write it.
 * @template {FsPermission} P
 * @typedef {{ permission: P, paths: string[] }} FsScope
 */

/** The folder a file is in. */
const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};

/**
 * @template {FsPermission} P
 * @param {P} permission
 * @param {string} path
 * @returns {FsScope<P>}
 */
export const scopeOf = (permission, path) => {
  const folder = folderOf(path);
  return { permission, paths: [`${folder}/**`] };
};

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** @param {PluginContext["bridge"]} bridge */
export function createGrants(bridge) {
  /**
   * One fs call, asking once for the folder when the grants do not cover the file.
   * @template T
   * @template {FsPermission} P
   * @param {P} permission
   * @param {string} path
   * @param {(scope: FsScope<P>) => Promise<T>} call
   * @param {string} [why] the ask's reason, when it is not opening or saving the file
   * @returns {Promise<T>}
   */
  const withGrant = async (permission, path, call, why) => {
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
    const reason = why ?? (verb === "read" ? `To open ${path} in Notes` : `To save ${path}`);
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

  /** A file's text, asking for its folder when the grants do not cover it. */
  const read = async (/** @type {string} */ path) => {
    const { content } = await withGrant("fs:read", path, (scope) =>
      bridge.call("fs.read", { path, encoding: "utf8", scope }),
    );
    return content;
  };

  /** A file's text without asking (a note coming back from a sleep), or undefined. */
  const quietly = (/** @type {string} */ path) =>
    bridge.call("fs.read", { path, encoding: "utf8", scope: scopeOf("fs:read", path) }).then(
      ({ content }) => content,
      () => undefined,
    );

  return { withGrant, read, quietly };
}
