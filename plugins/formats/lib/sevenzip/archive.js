// The Archive shape of plugins/archives/ui/formats/archive.js, which the 7z reader answers: its
// entries, detail rows and how to read one entry, over a Source read by byte ranges. Helpers for
// building it, as that file has them.

/**
 * @typedef {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} Source
 * read answers exactly min(length, size - offset) bytes.
 * @typedef {{
 *   path: string,
 *   kind: "file" | "folder" | "link",
 *   size: number,
 *   packed?: number,
 *   date?: Date,
 *   method?: string,
 *   encrypted?: boolean,
 *   link?: string,
 *   refusal?: string,
 * }} Entry
 * `path` uses "/" and has no leading "./" or trailing "/"; it keeps "..", a leading "/" and drive
 * letters as the archive wrote them, so extraction can refuse them. `refusal` says why this entry
 * cannot be read.
 * @typedef {{ label: string, value: string }} Detail
 * @typedef {{
 *   format: string,
 *   entries: Entry[],
 *   details: Detail[],
 *   note?: string,
 *   refusal?: string,
 *   read(entry: Entry, limit?: number): Promise<Uint8Array>,
 *   each?(entries: Entry[], visit: (entry: Entry, bytes: Uint8Array) => Promise<unknown>): Promise<void>,
 * }} Archive
 * `read` gives the entry's bytes (its first `limit` bytes when given); `each` reads several entries
 * in one pass (a solid block decoded once).
 */

export const ENCRYPTED = "Encrypted: not extracted.";

/** A name as an entry path: "\" and "/" both separate, "." and empty parts go. @param {string} raw */
export function cleanPath(raw) {
  const absolute = /^[\\/]/.test(raw);
  const parts = raw.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  return (absolute ? "/" : "") + parts.join("/");
}

/** Whether a path would leave the folder it is extracted to: absolute, a drive letter, or "..". @param {string} path */
const outside = (path) =>
  /^\//.test(path) || /^[A-Za-z]:/.test(path) || path.split("/").includes("..");

/** The folder a path is in, "" at the top. @param {string} path */
const parentOf = (path) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
};

/**
 * The entries with a later duplicate path winning, and a folder entry for every parent folder
 * the archive does not list itself.
 * @template {Entry} E
 * @param {E[]} entries
 * @returns {E[]}
 */
export function withFolders(entries) {
  /** @type {Map<string, E>} */
  const byPath = new Map();
  for (const entry of entries) {
    if (!entry.path) continue;
    byPath.delete(entry.path);
    byPath.set(entry.path, entry);
  }
  for (const entry of [...byPath.values()]) {
    if (outside(entry.path)) continue;
    for (let parent = parentOf(entry.path); parent && parent !== "/"; parent = parentOf(parent)) {
      if (byPath.has(parent)) break;
      byPath.set(parent, /** @type {E} */ ({ path: parent, kind: "folder", size: 0 }));
    }
  }
  return [...byPath.values()];
}

/** Part of a source, as a source of its own. @param {Source} source @param {number} offset @param {number} length */
export function sliceSource(source, offset, length) {
  const size = Math.max(0, Math.min(length, source.size - offset));
  return /** @type {Source} */ ({
    size,
    read: (at, n) => source.read(offset + Math.min(at, size), Math.max(0, Math.min(n, size - at))),
  });
}
