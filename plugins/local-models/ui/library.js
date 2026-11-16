// The model files on this computer: every .gguf under the models folders (the window's own,
// ~/.endue/local-models/models, and the ones the person adds), read for what they are from their
// headers. Split files count once (their first part), vision projectors (mmproj) go with the model
// beside them. What a header said is kept in library.json, read again only when a file changes.
import { describeGguf, readGguf } from "./gguf.js";
import { prettyName } from "./models.js";
import { fromBase64 } from "./net.js";

export const MODELS_DIR = "~/.endue/local-models/models";
export const CACHE_FILE = "~/.endue/local-models/library.json";
const DEPTH = 5;
const SKIP = new Set(["node_modules", ".git", "blobs", ".Trash"]);

/**
 * @typedef {import("./gguf.js").GgufInfo} GgufInfo
 * @typedef {{
 *   path: string,
 *   file: string,
 *   folder: string,
 *   name: string,
 *   size: number,
 *   modified?: string,
 *   info?: GgufInfo,
 *   error?: string,
 *   projector?: string,
 *   parts?: number,
 *   repo?: string,
 * }} LocalModel
 */

const SPLIT = /-(\d{5})-of-(\d{5})\.gguf$/i;

/** A path's folder and its last part. @param {string} path */
const split = (path) => {
  const at = path.lastIndexOf("/");
  return { folder: path.slice(0, at), file: path.slice(at + 1) };
};

/** "org/repo" from a path inside a models folder laid out as org/repo/file. @param {string} path @param {string[]} roots */
export function repoOf(path, roots) {
  for (const root of roots) {
    if (!path.startsWith(`${root}/`)) continue;
    const parts = path.slice(root.length + 1).split("/");
    if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  }
  return undefined;
}

/**
 * @param {{ bridge: import("./net.js").Bridge, readJson(path: string): Promise<any>, writeJson(path: string, v: unknown): Promise<unknown> }} store
 */
export function createLibrary(store) {
  const { bridge } = store;

  /** Every .gguf under a folder, depth-first, hidden folders skipped. @param {string} folder */
  async function walk(folder, depth = 0) {
    /** @type {{ path: string, size: number, modified?: string }[]} */
    const found = [];
    const answer = await bridge.call("fs.list", { path: folder }).catch(() => undefined);
    for (const entry of answer?.entries ?? []) {
      const path = `${folder}/${entry.name}`;
      if (entry.kind === "dir") {
        if (depth < DEPTH && !entry.name.startsWith(".") && !SKIP.has(entry.name))
          found.push(...(await walk(path, depth + 1)));
      } else if (/\.gguf$/i.test(entry.name)) {
        let size = entry.size;
        if (entry.kind !== "file")
          size = (
            await bridge
              .call("fs.read", { path, offset: 0, length: 0, encoding: "base64" })
              .catch(() => undefined)
          )?.size;
        found.push({ path, size: size ?? 0, modified: entry.modifiedAt });
      }
    }
    return found;
  }

  /** @param {string} path */
  const readAt = (path) => async (/** @type {number} */ offset, /** @type {number} */ length) => {
    const answer = await bridge.call("fs.read", { path, offset, length, encoding: "base64" });
    return fromBase64(answer.content);
  };

  /** @type {Record<string, { size: number, modified?: string, info?: GgufInfo, error?: string }>} */
  let cache = {};
  let loaded = false;

  /**
   * Look through the folders.
   * @param {string[]} folders @returns {Promise<LocalModel[]>}
   */
  async function scan(folders) {
    if (!loaded) {
      cache = (await store.readJson(CACHE_FILE).catch(() => undefined))?.entries ?? {};
      loaded = true;
    }
    const files = (await Promise.all(folders.map((f) => walk(f.replace(/\/+$/, ""))))).flat();
    let dirty = false;
    /** @type {LocalModel[]} */
    const models = [];
    /** @type {Map<string, string>} */
    const projectors = new Map();
    /** @type {Map<string, number>} */
    const partCounts = new Map();
    for (const f of files) {
      const { folder, file } = split(f.path);
      const part = SPLIT.exec(file);
      if (part) {
        const key = f.path.replace(SPLIT, "");
        partCounts.set(key, (partCounts.get(key) ?? 0) + f.size);
        if (part[1] !== "00001") continue;
      }
      if (/^mmproj/i.test(file) || /[-_.]mmproj[-_.]/i.test(file)) {
        projectors.set(folder, f.path);
        continue;
      }
      let entry = cache[f.path];
      if (!entry || entry.size !== f.size || entry.modified !== f.modified) {
        try {
          const header = await readGguf(readAt(f.path));
          const info = describeGguf(header, { size: f.size, name: prettyName(file) });
          if (info.chatTemplate && info.chatTemplate.length > 4000)
            info.chatTemplate = `${info.chatTemplate.slice(0, 4000)}…`;
          entry = { size: f.size, modified: f.modified, info };
        } catch (e) {
          entry = {
            size: f.size,
            modified: f.modified,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        cache[f.path] = entry;
        dirty = true;
      }
      if (entry.info?.projector) {
        projectors.set(folder, f.path);
        continue;
      }
      const whole = part ? (partCounts.get(f.path.replace(SPLIT, "")) ?? f.size) : f.size;
      models.push({
        path: f.path,
        file,
        folder,
        name:
          entry.info?.name && entry.info.name !== "unknown" ? entry.info.name : prettyName(file),
        size: whole,
        modified: f.modified,
        info: entry.info,
        error: entry.error,
        parts: part ? Number(part[2]) : undefined,
        repo: repoOf(f.path, folders),
      });
    }
    for (const m of models) {
      m.projector = projectors.get(m.folder);
      if (m.parts) m.size = partCounts.get(m.path.replace(SPLIT, "")) ?? m.size;
    }
    if (dirty) {
      const keep = new Set(files.map((f) => f.path));
      cache = Object.fromEntries(Object.entries(cache).filter(([p]) => keep.has(p)));
      await store.writeJson(CACHE_FILE, { version: 1, entries: cache }).catch(() => {});
    }
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Move a model's files (all its parts) to the trash. @param {LocalModel} m */
  async function remove(m) {
    const paths = m.parts
      ? Array.from({ length: m.parts }, (_, i) =>
          m.path.replace(
            SPLIT,
            `-${String(i + 1).padStart(5, "0")}-of-${String(m.parts).padStart(5, "0")}.gguf`,
          ),
        )
      : [m.path];
    for (const path of paths) await bridge.call("fs.trash", { path });
    delete cache[m.path];
  }

  return { scan, remove };
}

/** @typedef {ReturnType<typeof createLibrary>} Library */
