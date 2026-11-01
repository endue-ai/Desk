// What both RAR readers answer: entries in the Archive shape of endue.archives (paths with "/",
// kinds, sizes, dates, methods, the encrypted flag, refusals) and the sentences they fail with.

/**
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
 * @typedef {{ label: string, value: string }} Detail
 */

export const ENCRYPTED = "Encrypted: not extracted.";
export const SPLIT = "Split across volumes: not extracted.";
export const LOCKED = "The RAR's headers are encrypted, so its names cannot be listed.";
export const OLD_METHOD =
  "Compressed with RAR 1.5 or 2.0's method, which is not supported: not extracted.";
export const DAMAGED = "The RAR data is damaged and cannot be decoded.";
export const NOT_RAR = "This is not a RAR archive.";
/** @param {string} path */
export const badCrc = (path) =>
  `The data of ${path} does not match its CRC: the archive is damaged.`;

/** The -m levels by name. */
export const METHODS = ["Stored", "Fastest", "Fast", "Normal", "Good", "Best"];

/** A stored name as an entry path: "\" and "/" separate, "." and empty parts go. @param {string} raw */
export function cleanPath(raw) {
  const absolute = /^[\\/]/.test(raw);
  const parts = raw.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  return (absolute ? "/" : "") + parts.join("/");
}

/** @param {string} path */
const parentOf = (path) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
};

/**
 * The entries with a later duplicate path winning and a folder entry for every parent folder the
 * archive does not list itself (not for paths that leave the archive's folder).
 * @template {Entry} E @param {E[]} entries @returns {E[]}
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
    const path = entry.path;
    if (/^\//.test(path) || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) continue;
    for (let parent = parentOf(path); parent; parent = parentOf(parent)) {
      if (byPath.has(parent)) break;
      byPath.set(parent, /** @type {E} */ ({ path: parent, kind: "folder", size: 0 }));
    }
  }
  return [...byPath.values()];
}

/** @param {number} bytes */
export function sizeText(bytes) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${units[unit]}`;
}
