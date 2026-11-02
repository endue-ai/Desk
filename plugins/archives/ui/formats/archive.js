// What every format answers: its entries (files, folders and links with sizes, dates and methods),
// details shown above them, and how to read one entry. Shared helpers for building that.

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
 * `path` uses "/" and has no leading "./" or trailing "/"; it keeps "..", a leading "/" and drive
 * letters as the archive wrote them, so extraction can refuse them. `size` is the decoded size
 * (-1 when only decoding tells); `refusal` says why this entry cannot be read.
 * @typedef {{ label: string, value: string }} Detail
 * @typedef {{
 *   format: string,
 *   entries: Entry[],
 *   details: Detail[],
 *   note?: string,
 *   refusal?: string,
 *   read(entry: Entry, limit?: number, job?: Job): Promise<Uint8Array>,
 *   each?(entries: Entry[], visit: (entry: Entry, bytes: Uint8Array) => Promise<unknown>, job?: Job): Promise<void>,
 *   close?(): void,
 * }} Archive
 * `note` is the one sentence a details-only format shows; `refusal` why nothing is extracted;
 * `read` gives the entry's bytes (its first `limit` bytes when given); `each`, when a format has
 * it, reads several entries in one pass (a tar inside a stream, a solid 7z block); `close` ends
 * what the archive holds open (its library worker).
 * @typedef {{ signal?: AbortSignal, report?: (done: number, total: number) => void }} Job
 * The work a read belongs to: its signal stops it, `report` hears how far a decode is. Formats that
 * cannot stop or tell ignore it.
 */

export const ENCRYPTED = "Encrypted: not extracted.";

/**
 * A name as an entry path: "\" and "/" both separate, "." and empty parts go. With `relative`
 * (install paths in packages) a leading "/" goes too.
 * @param {string} raw @param {{ relative?: boolean }} [options]
 */
export function cleanPath(raw, { relative = false } = {}) {
  const absolute = !relative && /^[\\/]/.test(raw);
  const parts = raw.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  return (absolute ? "/" : "") + parts.join("/");
}

/** Whether a path would leave the folder it is extracted to: absolute, a drive letter, or "..". @param {string} path */
export const outside = (path) =>
  /^\//.test(path) || /^[A-Za-z]:/.test(path) || path.split("/").includes("..");

/** The folder a path is in, "" at the top. @param {string} path */
export const parentOf = (path) => {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
};
/** @param {string} path */
export const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

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

/** An archive with details only: nothing to list or read. @param {string} format @param {Detail[]} details @param {string} note */
export function detailsOnly(format, details, note) {
  return /** @type {Archive} */ ({
    format,
    entries: [],
    details,
    note,
    read: () => Promise.reject(new Error(note)),
  });
}

/** A detail row. @param {string} label @param {unknown} value */
export const row = (label, value) => ({ label, value: String(value) });
