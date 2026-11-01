// The Archive over the volumes of a disk: each readable volume's files under a folder of its own
// name when there are several, at the top when there is one. Detail rows say what each partition
// and volume is, and why one that is not listed is not.
import { part, row } from "../disk/archive.js";
import { formatSize, sizeDetail } from "../disk/bytes.js";
import { Refusal, Work } from "../disk/work.js";

/** @typedef {import("../disk/archive.js").Archive} Archive */
/** @typedef {import("../disk/archive.js").Entry} Entry */
/** @typedef {import("../disk/archive.js").Detail} Detail */
/** @typedef {import("../disk/archive.js").FileSystem} FileSystem */
/**
 * @typedef {{ name: string, fs?: FileSystem, refusal?: string }} Volume a volume to list: `name`
 * its folder when there are several, `fs` when it can be read, `refusal` why not.
 */

/** Whether the error is the caller's cancel, which is passed on as it is. @param {Work} work */
export const cancelled = (work) => !!work.signal?.aborted;

/** A refused image: its details and one sentence, nothing to list. @param {string} format @param {Detail[]} details @param {string} sentence @returns {Archive} */
export const refused = (format, details, sentence) => ({
  format,
  entries: [],
  details,
  note: sentence,
  refusal: sentence,
  read: () => Promise.reject(new Error(sentence)),
});

/** A volume's own rows: its file system, label, size and use, then what it adds. @param {FileSystem} fs */
export function volumeDetails(fs) {
  const details = [row("File system", fs.type)];
  if (fs.label) details.push(row("Label", fs.label));
  details.push(row("Size", sizeDetail(fs.size)));
  if (fs.used !== undefined) details.push(row("Used", sizeDetail(fs.used)));
  return [...details, ...(fs.details ?? [])];
}

/** "HFS+ “Apple HFS”, 1.2 MiB used". @param {FileSystem} fs */
export const volumeSummary = (fs) =>
  `${fs.type}${fs.label ? ` “${fs.label}”` : ""}${fs.used === undefined ? "" : `, ${formatSize(fs.used)} used`}`;

/** Each listed volume's folder: its name, made unique. @param {Volume[]} volumes */
function folders(volumes) {
  /** @type {Map<Volume, string>} */
  const names = new Map();
  const used = new Set();
  for (const volume of volumes) {
    if (!volume.fs) continue;
    const base = part(volume.name) || "Volume";
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);
    names.set(volume, name);
  }
  return names;
}

/**
 * The Archive over the volumes: their files, read on demand. A volume that lists nothing (an empty
 * EFI partition beside the app's volume) is left out when another lists something; with `describe`
 * the one volume left adds its own rows to the details.
 * @param {string} format @param {Detail[]} details @param {Volume[]} volumes @param {Work} work
 * @param {{ empty?: string, describe?: boolean }} [options] `empty` is the note when no volume can be listed
 * @returns {Promise<Archive>}
 */
export async function listing(format, details, volumes, work, options = {}) {
  /** @type {{ volume: Volume, fs: FileSystem, listed: import("../disk/archive.js").FileEntry[] }[]} */
  let lists = [];
  const several = volumes.filter((v) => v.fs).length > 1;
  for (const volume of volumes) {
    if (!volume.fs) continue;
    try {
      lists.push({ volume, fs: volume.fs, listed: await volume.fs.list(work) });
    } catch (error) {
      if (cancelled(work) || error instanceof Refusal || !several) throw error;
      details.push(row(volume.name, error instanceof Error ? error.message : String(error)));
    }
  }
  if (lists.some((l) => l.listed.length)) lists = lists.filter((l) => l.listed.length);
  if (options.describe && lists.length === 1 && lists[0])
    details.push(...volumeDetails(lists[0].fs));
  const names = folders(lists.map((l) => l.volume));
  const prefixed = lists.length > 1;
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Map<string, { fs: FileSystem, ref: unknown, entry: Entry }>} */
  const refs = new Map();
  for (const { volume, fs, listed } of lists) {
    const folder = names.get(volume) ?? "";
    if (prefixed) entries.push({ path: folder, kind: "folder", size: 0 });
    for (const { ref, ...entry } of listed) {
      if (prefixed) entry.path = `${folder}/${entry.path}`;
      entries.push(entry);
      refs.set(entry.path, { fs, ref, entry });
      if (entries.length % 4096 === 0) await work.tick();
    }
  }
  /** @type {Archive} */
  const archive = {
    format,
    entries,
    details,
    read: async (entry, limit = Number.POSITIVE_INFINITY, options = {}) => {
      const found = refs.get(entry.path);
      if (!found) throw new Error(`“${entry.path}” is not on this disk.`);
      if (found.entry.refusal) throw new Error(found.entry.refusal);
      if (found.entry.kind === "folder") throw new Error(`“${entry.path}” is a folder.`);
      if (found.entry.kind === "link") return new TextEncoder().encode(found.entry.link ?? "");
      const reading = new Work(options.signal);
      await reading.tick();
      return found.fs.read(found.ref, limit, reading);
    },
  };
  if (!volumes.some((v) => v.fs))
    archive.note =
      volumes.find((v) => v.refusal)?.refusal ??
      options.empty ??
      "No volume that can be read was found in the image.";
  return archive;
}
