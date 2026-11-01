// The plugin's file access: the SDK's byteSource (ranges through the file's fs.url URL, or ranged
// fs.read calls, with its block cache), asking once with perm.request for the file's folder when its
// grants do not cover it; fs.watch; and the scopes extraction writes under. Every failure is an
// Error whose message is the sentence the person reads.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext["bridge"]} Bridge
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./source.js").Source} Source
 * @typedef {(ctx: { bridge: Bridge }, file: { path: string, scope: { permission: "fs:read", paths: string[] } }) => Promise<Source>} ByteSource
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

/** byteSource's cache block, and the span (in blocks) its reads skip the cache from. */
const BLOCK = 64 * 1024;
const LONG = 32;

/**
 * `source` with each read that spans several cached blocks asked one block at a time. byteSource
 * fills a read's missing blocks and then copies them out; reads running at once (the library
 * worker's, a preview's, an extraction's) can push a block of one out of its cache in between, and
 * that read then fails. A read inside one block has nothing in between.
 * @param {Source} source @returns {Source}
 */
export function blockwise(source) {
  return {
    size: source.size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, source.size));
      const end = Math.min(source.size, start + Math.max(0, length));
      const first = Math.floor(start / BLOCK);
      const last = Math.floor((end - 1) / BLOCK);
      if (end <= start || first === last || last - first >= LONG)
        return source.read(start, end - start);
      const parts = [];
      for (let index = first; index <= last; index++) {
        const from = Math.max(start, index * BLOCK);
        parts.push(source.read(from, Math.min(end, (index + 1) * BLOCK) - from));
      }
      const out = new Uint8Array(end - start);
      let at = 0;
      for (const part of await Promise.all(parts)) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    },
  };
}

/** @param {Bridge} bridge @param {ByteSource} byteSource the SDK's */
export function createFiles(bridge, byteSource) {
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
    const failed = (error) => {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code === "permission_denied") return refused;
      if (code) return new Error(`Could not read ${path}: ${code}.`);
      return error instanceof Error ? error : new Error(`Could not read ${path}.`);
    };
    const acquire = async () => {
      const raw = await byteSource({ bridge }, { path, scope });
      // The first bytes inside the one ask: a URL can exist even when its fallback read is denied.
      await raw.read(0, Math.min(raw.size, 4096));
      return raw;
    };
    let raw;
    try {
      raw = await acquire();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
      if (!(await ask(scope, `To open ${path} in Archives`))) throw refused;
      raw = await acquire().catch((e) => Promise.reject(failed(e)));
    }
    const from = blockwise(raw);
    /** @type {Source} */
    const source = {
      size: from.size,
      read: (offset, length) => from.read(offset, length).catch((e) => Promise.reject(failed(e))),
    };
    return { source, size: from.size, scope };
  };

  /** Follow the file; undefined when it cannot be watched. @param {string} path */
  const watch = (path) =>
    bridge
      .call("fs.watch", { path, scope: scopeUnder("fs:read", folderOf(path)) })
      .then(({ watchId }) => watchId)
      .catch(() => undefined);

  return { open, watch, ask };
}
