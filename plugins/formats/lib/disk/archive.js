// The Archive shape of plugins/archives/ui/formats/archive.js, which disks answer: entries (files,
// folders and links with sizes and dates), detail rows, and how to read one file. The file systems
// answer their own entries with a private `ref` that says where the file's data lives.

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
 * @typedef {{ signal?: AbortSignal }} ReadOptions
 * @typedef {{
 *   format: string,
 *   entries: Entry[],
 *   details: Detail[],
 *   note?: string,
 *   refusal?: string,
 *   read(entry: Entry, limit?: number, options?: ReadOptions): Promise<Uint8Array>,
 * }} Archive
 * @typedef {Entry & { ref: unknown }} FileEntry an entry as a file system lists it: `path` from its
 * root, `ref` its own handle for `read`.
 * @typedef {{
 *   type: string,
 *   label: string,
 *   size: number,
 *   used?: number,
 *   details?: Detail[],
 *   list(work: import("./work.js").Work): Promise<FileEntry[]>,
 *   read(ref: unknown, limit: number, work: import("./work.js").Work): Promise<Uint8Array>,
 * }} FileSystem
 * `type` is "FAT12", "FAT16", "FAT32", "exFAT", "ext2", "ext3", "ext4" or "NTFS"; `size` and `used`
 * are bytes; `read` answers the first `limit` bytes of the file (all of it when `limit` is Infinity).
 */

export const ENCRYPTED = "Encrypted: not extracted.";

/** A detail row. @param {string} label @param {unknown} value */
export const row = (label, value) => ({ label, value: String(value) });

/** A name as one path part: no "/" inside it, never "." or "..". @param {string} name */
export const part = (name) => {
  const clean = name.replace(/\//g, "_").replace(/\0/g, "");
  return clean === "." || clean === ".." ? clean.replace(/\./g, "_") : clean;
};
