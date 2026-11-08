// exFAT, read only, from Microsoft's exFAT file system specification: the boot sector checked
// before anything is trusted, the active FAT, directory entry sets (file, stream extension and file
// name entries), contiguous files that skip the FAT (NoFatChain), bytes past a file's valid data
// length read as zeros, and timestamps with their 10 ms steps and UTC offsets.
import { part, row } from "./archive.js";
import { at, formatSize, u16, u32, u64, utf16le } from "./bytes.js";
import { chain, fatTable, readClusters, readRange } from "./fat-chains.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./work.js").Work} Work */
/** @typedef {import("./archive.js").FileEntry} FileEntry */
/**
 * @typedef {{ name: string, folder: boolean, contiguous: boolean, cluster: number, size: number,
 *   valid: number, date?: Date }} Item
 * A file or folder from its entry set: where its data starts, whether its clusters are contiguous
 * (NoFatChain), its data length and the valid part of it.
 */

const MOST_DIRECTORY = 256 * 1024 * 1024; // a directory is at most 256 MiB
const MOST_BITMAP = 8 * 1024 * 1024;

/**
 * A timestamp: local fields, two-second steps plus 10 ms steps, and the offset from UTC in
 * 15-minute steps when its valid bit is set (local wall-clock time otherwise).
 * @param {number} stamp @param {number} centis @param {number} offset
 */
function timestamp(stamp, centis, offset) {
  if (!stamp) return undefined;
  const fields = /** @type {const} */ ([
    1980 + (stamp >>> 25),
    ((stamp >>> 21) & 15) - 1,
    (stamp >>> 16) & 31,
    (stamp >>> 11) & 31,
    (stamp >>> 5) & 63,
    (stamp & 31) * 2,
    Math.min(centis, 199) * 10,
  ]);
  const d =
    offset & 0x80
      ? new Date(Date.UTC(...fields) - (((offset & 0x7f) ^ 0x40) - 0x40) * 15 * 60000)
      : new Date(...fields);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * The files and folders of a directory's bytes, its volume label and its allocation bitmaps.
 * @param {Uint8Array} data
 */
function parse(data) {
  /** @type {Item[]} */
  const items = [];
  let label = "";
  /** @type {{ flags: number, cluster: number, length: number }[]} */
  const bitmaps = [];
  for (let o = 0; o + 32 <= data.length; o += 32) {
    const type = data[o] ?? 0;
    if (type === 0) break;
    if (!(type & 0x80)) continue; // unused or deleted
    if (type === 0x83) {
      label = utf16le(data.subarray(o + 2, o + 2 + Math.min(11, data[o + 1] ?? 0) * 2));
      continue;
    }
    if (type === 0x81) {
      bitmaps.push({
        flags: data[o + 1] ?? 0,
        cluster: u32(data, o + 20),
        length: u64(data, o + 24),
      });
      continue;
    }
    if (type !== 0x85) continue;
    const secondary = data[o + 1] ?? 0;
    const stream = o + 32;
    if (secondary < 2 || o + 32 * (secondary + 1) > data.length || data[stream] !== 0xc0) continue;
    let name = "";
    for (let k = 2; k <= secondary; k++) {
      const e = o + 32 * k;
      if (data[e] !== 0xc1) break;
      name += utf16le(data.subarray(e + 2, e + 32));
    }
    name = name.slice(0, data[stream + 3] ?? 0);
    const flags = data[stream + 1] ?? 0;
    const item = {
      name: part(name),
      folder: !!(u16(data, o + 4) & 0x10),
      contiguous: !!(flags & 2),
      cluster: flags & 1 ? u32(data, stream + 20) : 0,
      size: u64(data, stream + 24),
      valid: u64(data, stream + 8),
      date: timestamp(u32(data, o + 12), data[o + 21] ?? 0, data[o + 23] ?? 0),
    };
    if (name && name !== "." && name !== "..") items.push(item);
    o += 32 * secondary;
  }
  return { items, label, bitmaps };
}

/** Set bits in the first `count` bits. @param {Uint8Array} bits @param {number} count */
function countBits(bits, count) {
  let set = 0;
  for (let i = 0; i < Math.ceil(count / 8); i++) {
    let byte = bits[i] ?? 0;
    if (i === Math.floor(count / 8)) byte &= (1 << (count % 8)) - 1;
    for (; byte; byte &= byte - 1) set++;
  }
  return set;
}

/**
 * Open an exFAT volume.
 * @param {Source} source @param {Work} work @returns {Promise<import("./archive.js").FileSystem>}
 */
export async function openExfat(source, work) {
  await work.tick();
  const b = await source.read(0, 512);
  const bad = (/** @type {string} */ what) => damaged(`The exFAT boot sector is damaged: ${what}.`);
  if (b.length < 512 || !at(b, 3, "EXFAT   ")) throw bad("its signature is missing");
  const sectorShift = b[108] ?? 0;
  const clusterShift = b[109] ?? 0;
  if (sectorShift < 9 || sectorShift > 12) throw bad("its sector size is not one exFAT allows");
  if (clusterShift > 25 - sectorShift) throw bad("its cluster size is not one exFAT allows");
  const bps = 2 ** sectorShift;
  const clusterBytes = 2 ** (sectorShift + clusterShift);
  const volumeLength = u64(b, 72);
  const fatOffset = u32(b, 80);
  const fatLength = u32(b, 84);
  const heap = u32(b, 88);
  const count = u32(b, 92);
  const rootCluster = u32(b, 96);
  const fats = b[110] ?? 0;
  const percent = b[112] ?? 0xff;
  if (fats !== 1 && fats !== 2) throw bad(`${fats} file allocation tables is not one or two`);
  if (fatOffset < 24 || heap < fatOffset + fatLength * fats) throw bad("its regions overlap");
  if (!count || heap + count * 2 ** clusterShift > volumeLength)
    throw bad("its clusters go past the end of the volume");
  if (fatLength * bps < (count + 2) * 4) throw bad("its FAT is too small for its clusters");
  if (rootCluster < 2 || rootCluster > count + 1)
    throw bad("its root directory is outside the volume");

  const active = fats === 2 && u16(b, 106) & 1 ? 1 : 0;
  const next = fatTable(
    source,
    (fatOffset + active * fatLength) * bps,
    fatLength * bps,
    32,
    "exFAT",
  );
  const options = { count, end: 0xfffffff8, mask: 0xffffffff, work };
  const offsetOf = (/** @type {number} */ c) => heap * bps + (c - 2) * clusterBytes;

  /**
   * The first `want` bytes stored from `cluster`: contiguous, or through the FAT. A broken chain
   * fails when `strict`, and gives what it has otherwise (a directory read as far as it goes).
   */
  const data = async (
    /** @type {number} */ cluster,
    /** @type {boolean} */ contiguous,
    /** @type {number} */ want,
    /** @type {Work} */ w,
    strict = true,
  ) => {
    if (want <= 0) return new Uint8Array(0);
    const most = Math.ceil(want / clusterBytes);
    if (contiguous) {
      if (cluster < 2 || cluster + most - 1 > count + 1)
        throw damaged("The exFAT volume is damaged: a file's clusters are outside the volume.");
      const out = new Uint8Array(want);
      await readRange(source, offsetOf(cluster), want, out, 0, w, "exFAT");
      return out;
    }
    const { clusters } = await chain(next, cluster, { ...options, most, work: w });
    if (clusters.length < most && strict)
      throw damaged(
        "The exFAT volume is damaged: a file's cluster chain ends before the file does.",
      );
    const length = Math.min(want, clusters.length * clusterBytes);
    return readClusters(source, offsetOf, clusterBytes, clusters, length, w, "exFAT");
  };
  /** A directory's bytes; the root's length is known only from its chain. */
  const directory = (/** @type {Item | undefined} */ item, /** @type {Work} */ w) =>
    item
      ? data(item.cluster, item.contiguous, Math.min(item.size, MOST_DIRECTORY), w, false)
      : data(rootCluster, false, MOST_DIRECTORY, w, false);

  const root = parse(await directory(undefined, work));
  const bitmap = root.bitmaps.find((m) => (m.flags & 1) === active) ?? root.bitmaps[0];
  let used;
  if (bitmap && bitmap.length <= MOST_BITMAP && bitmap.length * 8 >= count)
    used = countBits(await data(bitmap.cluster, false, bitmap.length, work), count) * clusterBytes;
  else if (percent <= 100) used = Math.round((percent / 100) * count) * clusterBytes;

  return {
    type: "exFAT",
    label: root.label,
    size: volumeLength * bps,
    used,
    details: [row("Cluster size", formatSize(clusterBytes))],
    async list(w) {
      /** @type {FileEntry[]} */
      const out = [];
      /** @type {{ path: string, items: Item[] }[]} */
      const stack = [{ path: "", items: root.items }];
      const seen = new Set([rootCluster]);
      while (stack.length) {
        const { path, items } = /** @type {{ path: string, items: Item[] }} */ (stack.pop());
        await w.tick();
        for (const item of items) {
          const full = path ? `${path}/${item.name}` : item.name;
          const size = item.folder ? 0 : item.size;
          const entry = { path: full, kind: item.folder ? "folder" : "file", size, ref: item };
          out.push(/** @type {FileEntry} */ (item.date ? { ...entry, date: item.date } : entry));
          if (!item.folder || item.cluster < 2 || seen.has(item.cluster)) continue;
          seen.add(item.cluster);
          stack.push({ path: full, items: parse(await directory(item, w)).items });
        }
      }
      return out;
    },
    async read(ref, limit, w) {
      const item = /** @type {Item} */ (ref);
      const want = Math.max(0, Math.min(limit, item.size));
      const stored = Math.min(want, item.valid);
      if (stored > 0 && !item.cluster)
        throw damaged(`The exFAT volume is damaged: “${item.name}” has data but no clusters.`);
      const bytes = await data(item.cluster, item.contiguous, stored, w);
      if (bytes.length === want) return bytes;
      const out = new Uint8Array(want); // past the valid data length, zeros
      out.set(bytes);
      return out;
    },
  };
}
