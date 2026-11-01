// The player's file calls: fs.url for what the webview plays, fs.read ranges (base64, at most 1 MiB a
// call) for headers, tags and the small files it reads itself, fs.list for subtitles next to a video
// and fs.watch. A call the grants do not cover may ask once, with perm.request, for the file's folder;
// only the first call of a visit asks, so one file costs the person at most one question.
import { fromBase64 } from "./bytes.js";
import { createSource } from "./source.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {{ permission: "fs:read", paths: string[] }} ReadScope
 */

export const CHUNK = 1 << 20;

/** The folder a file is in: the player asks for, and reads under, whole folders. */
export const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
export const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** @returns {ReadScope} */
export function scopeOf(/** @type {string} */ path) {
  const folder = folderOf(path);
  return { permission: /** @type {const} */ ("fs:read"), paths: [`${folder}/**`] };
}

export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** An Error whose message is the sentence the person reads, and whose code says what happened. */
export class FileError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** @param {Pick<PluginContext, "bridge">} ctx */
export function createAccess({ bridge }) {
  /**
   * One call under the folder's scope. On a refusal it asks once for the folder when `ask` says so,
   * and tries again; every failure is a FileError.
   * @template T
   * @param {string} path
   * @param {(scope: ReadScope) => Promise<T>} call
   * @param {boolean} ask
   * @returns {Promise<T>}
   */
  const withGrant = async (path, call, ask) => {
    const scope = scopeOf(path);
    const refused = new FileError(`Not allowed to read ${path}.`, "permission_denied");
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new FileError(`Could not read ${path}: ${codeOf(error)}.`, codeOf(error));
    try {
      return await call(scope);
    } catch (error) {
      if (codeOf(error) !== "permission_denied" || !ask) throw failed(error);
    }
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", {
        permission: /** @type {Permission} */ (scope),
        reason: `To open ${path} in Player`,
      })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call(scope);
    } catch (error) {
      throw failed(error);
    }
  };

  /**
   * A range of the file as bytes, with the file's size.
   * @param {string} path
   * @param {number} offset
   * @param {number} length at most CHUNK
   * @param {boolean} [ask]
   */
  const range = async (path, offset, length, ask = false) => {
    const answer = await withGrant(
      path,
      (scope) =>
        bridge.call("fs.read", {
          path,
          encoding: "base64",
          offset,
          length: Math.min(length, CHUNK),
          scope,
        }),
      ask,
    );
    const bytes = fromBase64(answer.content);
    return { bytes, size: answer.size ?? offset + bytes.length };
  };

  return {
    /** The URL the webview plays the file from, with its size and media type. */
    url: (/** @type {string} */ path, ask = true) =>
      withGrant(path, (scope) => bridge.call("fs.url", { path, scope }), ask),
    range,
    /**
     * The whole file, in ranges, when it is at most `max` bytes; `head` is what was read already.
     * @param {string} path
     * @param {number} size
     * @param {number} max
     * @param {Uint8Array} [head]
     */
    async all(path, size, max, head) {
      if (size > max)
        throw new FileError(
          `${nameOf(path)} is larger than ${Math.round(max / CHUNK)} MiB.`,
          "too_large",
        );
      const out = new Uint8Array(size);
      let at = 0;
      if (head) {
        out.set(head.subarray(0, size));
        at = Math.min(size, head.length);
      }
      while (at < size) {
        const { bytes } = await range(path, at, CHUNK);
        if (bytes.length === 0) break;
        out.set(bytes.subarray(0, size - at), at);
        at += bytes.length;
      }
      return out.subarray(0, at);
    },
    /** The file as a ranged source for the readers, seeded with the head already read. */
    source(
      /** @type {string} */ path,
      /** @type {number} */ size,
      /** @type {Uint8Array | undefined} */ head,
    ) {
      const source = createSource(
        size,
        async (offset, length) => (await range(path, offset, length)).bytes,
      );
      if (head) source.seed(0, head);
      return source;
    },
    /** The names of the files in a folder; nothing when the folder cannot be listed. */
    async list(/** @type {string} */ folder) {
      const scope = { permission: /** @type {const} */ ("fs:read"), paths: [`${folder}/**`] };
      const answer = await bridge
        .call("fs.list", { path: folder, scope })
        .catch(() => ({ entries: [] }));
      return answer.entries.filter((e) => e.kind !== "dir").map((e) => e.name);
    },
    /** Follow the file on disk; resolves with the watch id, or undefined without a watch. */
    watch: (/** @type {string} */ path) =>
      bridge.call("fs.watch", { path, scope: scopeOf(path) }).then(
        (answer) => answer.watchId,
        () => undefined,
      ),
  };
}
