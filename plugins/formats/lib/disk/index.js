// Disk images opened as the files inside them: the container (raw, VHD, VHDX, VMDK, QCOW2) gives
// the virtual disk, its partition table (GPT or MBR) the volumes, and each FAT, exFAT, ext or NTFS
// volume its files. Entries are "<partition>/<path>", or "<path>" when the disk holds one file
// system. Only the tables, directories and files asked for are read.
import { part, row } from "./archive.js";
import { formatSize, sizeDetail } from "./bytes.js";
import { openContainer } from "./containers.js";
import { identify, mount } from "./filesystem.js";
import { readTable } from "./partitions.js";
import { cachedSource, sliceSource } from "./source.js";
import { Refusal, Work } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./archive.js").Entry} Entry */
/** @typedef {import("./archive.js").Detail} Detail */
/** @typedef {import("./archive.js").FileSystem} FileSystem */
/** @typedef {import("./partitions.js").Partition} Partition */
/**
 * @typedef {{ signal?: AbortSignal, open?: (name: string) => Promise<Source | undefined> }} DiskOptions
 * @typedef {{ source: Source, partition?: Partition, kind?: import("./filesystem.js").Kind,
 *   fs?: FileSystem, failure?: string }} Volume
 */

export { openContainer };

/** A refused image: its details and one sentence, nothing to list. @param {string} format @param {Detail[]} details @param {string} sentence */
const refused = (format, details, sentence) =>
  /** @type {Archive} */ ({
    format,
    entries: [],
    details,
    note: sentence,
    refusal: sentence,
    read: () => Promise.reject(new Error(sentence)),
  });

/** Whether the error is the caller's cancel, which is passed on as it is. @param {Work} work */
const cancelled = (work) => !!work.signal?.aborted;

/**
 * Open a disk image (or a bare file-system image) as an Archive.
 * @param {Source} source @param {DiskOptions} [options] @returns {Promise<Archive>}
 */
export async function openDisk(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  /** @type {import("./containers.js").Container | undefined} */
  let container;
  try {
    container = await openContainer(source, options);
    await work.tick();
    return await browse(container, work);
  } catch (error) {
    if (error instanceof Refusal && !cancelled(work))
      return refused(
        container?.format ?? error.format,
        container?.details ?? error.details,
        error.message,
      );
    throw error;
  }
}

/**
 * Open a bare file-system image as an Archive. Throws a sentence when no readable file system is
 * there or its structures are damaged.
 * @param {Source} source @param {{ signal?: AbortSignal }} [options] @returns {Promise<Archive>}
 */
export async function openFilesystem(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  const volume = cachedSource(source);
  const kind = await identify(volume);
  if (!kind) throw new Error("No file system that can be read was found in the image.");
  const fs = await mount(volume, kind, work);
  return listing(fs.type, volumeDetails(fs), [{ source: volume, kind, fs }], false, work);
}

/** @param {import("./containers.js").Container} container @param {Work} work */
async function browse(container, work) {
  const disk = cachedSource(container.disk);
  const table = await readTable(disk, work);
  /** @type {Volume[]} */
  const volumes = table
    ? table.partitions.map((partition) => ({
        source: sliceSource(disk, partition.start, partition.size),
        partition,
      }))
    : [{ source: disk }];
  for (const volume of volumes) {
    await work.tick();
    volume.kind = await identify(volume.source);
    if (!volume.kind?.kind) continue;
    try {
      volume.fs = await mount(volume.source, volume.kind, work);
    } catch (error) {
      if (cancelled(work) || error instanceof Refusal) throw error;
      volume.failure = error instanceof Error ? error.message : String(error);
    }
  }
  const raw = container.format === "Disk image";
  /** @type {Detail[]} */
  const details = table || !raw ? [...container.details] : [];
  if (table) {
    details.push(...table.details);
    for (const volume of volumes) details.push(partitionRow(volume));
  } else {
    const [only] = volumes;
    if (only?.fs) details.push(...volumeDetails(only.fs));
    else if (only?.kind) details.push(row("File system", only.kind.name));
  }
  const readable = volumes.filter((v) => v.kind?.kind);
  const archive = await listing(
    container.format,
    details,
    volumes,
    !!table && readable.length > 1,
    work,
  );
  if (!volumes.some((v) => v.fs)) archive.note = emptyNote(volumes, !!table);
  return archive;
}

/** @param {FileSystem} fs */
function volumeDetails(fs) {
  const details = [row("File system", fs.type)];
  if (fs.label) details.push(row("Label", fs.label));
  details.push(row("Size", sizeDetail(fs.size)));
  if (fs.used !== undefined) details.push(row("Used", sizeDetail(fs.used)));
  return [...details, ...(fs.details ?? [])];
}

/** "EFI, EFI system, 100 MiB; FAT32 “ESP”, 1.2 MiB used". @param {Volume} volume */
function partitionRow({ partition, kind, fs, failure }) {
  const p = /** @type {Partition} */ (partition);
  const where = [
    p.name,
    p.code.startsWith("0x") ? `${p.type} (${p.code})` : p.type,
    formatSize(p.size),
  ];
  let what = "";
  if (fs) {
    const label = fs.label ? ` “${fs.label}”` : "";
    what = `${fs.type}${label}${fs.used === undefined ? "" : `, ${formatSize(fs.used)} used`}`;
  } else if (failure) what = failure;
  else if (kind) what = `${kind.name}, not read here`;
  return row(
    `Partition ${p.number}`,
    [where.filter(Boolean).join(", "), what].filter(Boolean).join("; "),
  );
}

/** The note when no volume could be listed. @param {Volume[]} volumes @param {boolean} table */
function emptyNote(volumes, table) {
  const failure = volumes.find((v) => v.failure)?.failure;
  if (failure) return failure;
  const other = volumes.find((v) => v.kind)?.kind;
  if (other)
    return `The ${table ? "disk" : "image"} holds ${other.name === "Linux swap" ? "" : "a "}${other.name}${other.name === "Linux swap" ? " space" : " volume"}, which is not read here.`;
  return table
    ? "None of the disk's partitions holds a file system that can be read."
    : "No partition table or file system that can be read was found in the image.";
}

/** The folder a partition's files go under: its file system's label, its GPT name, or its number. @param {Volume[]} volumes */
function folders(volumes) {
  /** @type {Map<Volume, string>} */
  const names = new Map();
  const used = new Set();
  for (const volume of volumes) {
    if (!volume.fs) continue;
    const p = volume.partition;
    let name =
      part(volume.fs.label || p?.name || `Partition ${p?.number ?? 1}`) ||
      `Partition ${p?.number ?? 1}`;
    if (used.has(name)) name = `${name} (${p?.number})`;
    used.add(name);
    names.set(volume, name);
  }
  return names;
}

/**
 * The Archive over the listed volumes.
 * @param {string} format @param {Detail[]} details @param {Volume[]} volumes @param {boolean} prefixed @param {Work} work
 * @returns {Promise<Archive>}
 */
async function listing(format, details, volumes, prefixed, work) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Map<string, { fs: FileSystem, ref: unknown, entry: Entry }>} */
  const refs = new Map();
  const names = folders(volumes);
  for (const volume of volumes) {
    const fs = volume.fs;
    if (!fs) continue;
    const folder = names.get(volume) ?? "";
    if (prefixed) entries.push({ path: folder, kind: "folder", size: 0 });
    let listed;
    try {
      listed = await fs.list(work);
    } catch (error) {
      if (cancelled(work) || error instanceof Refusal || !prefixed) throw error;
      details.push(row(`${folder}`, error instanceof Error ? error.message : String(error)));
      continue;
    }
    for (const { ref, ...entry } of listed) {
      if (prefixed) entry.path = `${folder}/${entry.path}`;
      entries.push(entry);
      refs.set(entry.path, { fs, ref, entry });
      if (entries.length % 4096 === 0) await work.tick();
    }
  }
  return {
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
}
