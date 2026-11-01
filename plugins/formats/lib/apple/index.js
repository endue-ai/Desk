// Apple disk images and file systems opened as the files inside them: a DMG (UDIF) gives the disk,
// its partition map (GPT, the Apple Partition Map or MBR) the volumes, and each HFS+, HFSX or APFS
// volume (FAT, exFAT, NTFS and ext through lib/disk) its files. Entries are "<volume>/<path>", or
// "<path>" when the disk holds one volume. Only the tables, folders and files asked for are read.
import { row } from "../disk/archive.js";
import { formatSize } from "../disk/bytes.js";
import { identify, mount } from "../disk/filesystem.js";
import { readTable } from "../disk/partitions.js";
import { cachedSource, sliceSource } from "../disk/source.js";
import { Refusal, Work } from "../disk/work.js";
import { openApfsContainer } from "./apfs.js";
import { readApm } from "./apm.js";
import { hfsOffset, openHfsVolume } from "./hfs.js";
import { readUdif } from "./udif.js";
import { cancelled, listing, refused, volumeDetails, volumeSummary } from "./volumes.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/archive.js").Archive} Archive */
/** @typedef {import("../disk/archive.js").Detail} Detail */
/** @typedef {import("../disk/partitions.js").Partition} Partition */
/** @typedef {import("./volumes.js").Volume} Volume */
/** @typedef {{ signal?: AbortSignal }} Options */

/**
 * The disk inside a DMG as a Source, with the image's details; a file with no UDIF trailer is
 * taken as the disk itself. Encrypted and split images throw a Refusal with their sentence.
 * @param {Source} source @param {Options} [options]
 */
export async function openUdif(source, options = {}) {
  return readUdif(source, new Work(options.signal));
}

/**
 * Open a DMG (or a raw disk image of an Apple disk) as an Archive. An encrypted image, or one of
 * a kind not read here, answers its details and one sentence; damage throws a sentence.
 * @param {Source} source @param {Options} [options] @returns {Promise<Archive>}
 */
export async function openDmg(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  /** @type {{ format: string, details: Detail[], disk: Source } | undefined} */
  let image;
  try {
    image = await readUdif(source, work);
    return await browse(image.format, [...image.details], cachedSource(image.disk), work);
  } catch (error) {
    if (error instanceof Refusal && !cancelled(work))
      return refused(
        image?.format ?? (error.format || "Apple disk image"),
        image?.details ?? error.details,
        error.message,
      );
    throw error;
  }
}

/**
 * Open a bare HFS+ or HFSX volume (or one inside an HFS wrapper) as an Archive.
 * @param {Source} source @param {Options} [options] @returns {Promise<Archive>}
 */
export async function openHfs(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  const volume = cachedSource(source);
  const offset = (await hfsOffset(volume, await volume.read(0, 4096))) ?? 0;
  const inner = offset ? sliceSource(volume, offset, volume.size - offset) : volume;
  const fs = await openHfsVolume(inner, work);
  return listing(fs.type, volumeDetails(fs), [{ name: fs.label, fs }], work);
}

/**
 * Open an APFS container (a partition, or a bare container image) as an Archive: every volume
 * that is not encrypted, under its name when there are several.
 * @param {Source} source @param {Options} [options] @returns {Promise<Archive>}
 */
export async function openApfs(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  try {
    const container = await openApfsContainer(cachedSource(source), work);
    return listing("APFS", container.details, container.volumes, work, { describe: true });
  } catch (error) {
    if (error instanceof Refusal && !cancelled(work))
      return refused("APFS", error.details, error.message);
    throw error;
  }
}

/** The partition map: the Apple Partition Map, GPT or MBR. @param {Source} disk @param {Work} work */
async function partitionMap(disk, work) {
  const apm = await readApm(disk, work);
  if (apm) return apm;
  return readTable(disk, work);
}

/**
 * What one volume holds, opened: HFS+ (or HFS+ inside an HFS wrapper), APFS, or what lib/disk
 * reads; anything else named. `rows` are an APFS container's own (its volumes, which are encrypted).
 * @param {Source} volume @param {string} name @param {Work} work
 * @returns {Promise<{ volumes: Volume[], rows: Detail[], what: string }>}
 */
async function open(volume, name, work) {
  const head = await volume.read(0, 4096);
  const hfs = await hfsOffset(volume, head);
  if (hfs !== undefined) {
    const inner = hfs ? sliceSource(volume, hfs, volume.size - hfs) : volume;
    const fs = await openHfsVolume(inner, work);
    return { volumes: [{ name: fs.label || name, fs }], rows: [], what: volumeSummary(fs) };
  }
  if (head[32] === 0x4e && head[33] === 0x58 && head[34] === 0x53 && head[35] === 0x42) {
    const { volumes, details } = await openApfsContainer(volume, work);
    const readable = volumes.filter((v) => v.fs).length;
    const count = `${volumes.length} ${volumes.length === 1 ? "volume" : "volumes"}`;
    const what = `APFS container, ${count}${readable < volumes.length ? `, ${readable} read here` : ""}`;
    return { volumes, rows: details, what };
  }
  const kind = await identify(volume);
  if (kind?.kind) {
    const fs = await mount(volume, kind, work);
    return { volumes: [{ name: fs.label || name, fs }], rows: [], what: volumeSummary(fs) };
  }
  if (!kind) return { volumes: [], rows: [], what: "" };
  const refusal = `The disk holds a ${kind.name} volume, which is not read here.`;
  return { volumes: [{ name, refusal }], rows: [], what: `${kind.name}, not read here` };
}

/** @param {string} format @param {Detail[]} details @param {Source} disk @param {Work} work */
async function browse(format, details, disk, work) {
  const table = await partitionMap(disk, work);
  if (!table) {
    const { volumes, rows } = await open(disk, "Disk", work);
    const empty = "The disk image holds no volume that can be read.";
    return listing(format, [...details, ...rows], volumes, work, { empty, describe: true });
  }
  details.push(...table.details);
  /** @type {Volume[]} */
  const volumes = [];
  for (const partition of table.partitions) {
    await work.tick();
    const source = sliceSource(disk, partition.start, partition.size);
    try {
      const opened = await open(source, partition.name || `Partition ${partition.number}`, work);
      volumes.push(...opened.volumes);
      details.push(partitionRow(partition, opened.what));
      // A container's own rows when they tell more than the partition's: several volumes, or one not read.
      if (opened.volumes.length > 1 || opened.volumes.some((v) => !v.fs))
        details.push(...opened.rows);
    } catch (error) {
      if (cancelled(work)) throw error;
      const why = error instanceof Error ? error.message : String(error);
      volumes.push({ name: partition.name, refusal: why });
      details.push(partitionRow(partition, why));
    }
  }
  const empty = "None of the disk's partitions holds a volume that can be read.";
  return listing(format, details, volumes, work, { empty, describe: true });
}

/** "Partition 2: disk image, Apple_HFS, 3.9 MiB; HFS+ “Apple HFS”, 1.2 MiB used". @param {Partition} p @param {string} what */
function partitionRow(p, what) {
  const where = [
    p.name,
    p.code.startsWith("0x") ? `${p.type} (${p.code})` : p.type,
    formatSize(p.size),
  ];
  return row(
    `Partition ${p.number}`,
    [where.filter(Boolean).join(", "), what].filter(Boolean).join("; "),
  );
}
