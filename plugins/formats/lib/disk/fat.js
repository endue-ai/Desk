// FAT12, FAT16 and FAT32, read only, from Microsoft's FAT specification: the BPB checked before
// anything is trusted, the type told by the count of clusters (FAT32 by its BPB), directories with
// their long names (checked against the short name's checksum) and the NT case bits, and files read
// one run of neighbouring clusters at a time.
import { part, row } from "./archive.js";
import { dosDate, formatSize, u16, u32, utf16le } from "./bytes.js";
import { chain, fatTable, readClusters, readRange } from "./fat-chains.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./work.js").Work} Work */
/** @typedef {import("./archive.js").FileEntry} FileEntry */
/**
 * @typedef {{ name: string, attr: number, cluster: number, size: number, date?: Date }} Item
 * A directory entry: its name (long when it has one), attributes, first cluster and size.
 */

const DIRECTORY = 0x10;
const MOST_DIRECTORY = 65536 * 32; // a FAT directory holds at most 65,536 entries

// The upper half of code page 437, which short names use.
const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
/** @param {Uint8Array} b */
const cp437 = (b) => {
  let s = "";
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : CP437.charAt(c - 0x80);
  return s;
};

const pow2 = (/** @type {number} */ n) => n > 0 && (n & (n - 1)) === 0;

/** The checksum of an 11-byte short name, which its long-name entries repeat. @param {Uint8Array} name */
function checksum(name) {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum = (((sum & 1) << 7) + (sum >> 1) + (name[i] ?? 0)) & 0xff;
  return sum;
}

/** The 13 UTF-16 characters a long-name entry holds. @param {Uint8Array} e */
const longPart = (e) =>
  utf16le(e.subarray(1, 11)) + utf16le(e.subarray(14, 26)) + utf16le(e.subarray(28, 32));

/** A short name with its NT case bits. @param {Uint8Array} e */
function shortName(e) {
  const raw = e.slice(0, 11);
  if (raw[0] === 0x05) raw[0] = 0xe5;
  let base = cp437(raw.subarray(0, 8)).trimEnd();
  let ext = cp437(raw.subarray(8, 11)).trimEnd();
  if ((e[12] ?? 0) & 0x08) base = base.toLowerCase();
  if ((e[12] ?? 0) & 0x10) ext = ext.toLowerCase();
  return ext ? `${base}.${ext}` : base;
}

/**
 * The entries of a directory's bytes, and its volume label when it has one.
 * @param {Uint8Array} data @param {boolean} fat32
 */
function parse(data, fat32) {
  /** @type {Item[]} */
  const items = [];
  let label = "";
  /** @type {{ parts: string[], sum: number, expect: number } | null} */
  let long = null;
  for (let o = 0; o + 32 <= data.length; o += 32) {
    const e = data.subarray(o, o + 32);
    const first = e[0] ?? 0;
    if (first === 0) break;
    const attr = e[11] ?? 0;
    if (first === 0xe5) {
      long = null;
      continue;
    }
    if ((attr & 0x3f) === 0x0f) {
      const order = first & 0x1f;
      if (first & 0x40) long = { parts: new Array(order).fill(""), sum: e[13] ?? 0, expect: order };
      if (!long || order < 1 || order !== long.expect || e[13] !== long.sum) {
        long = null;
        continue;
      }
      long.parts[order - 1] = longPart(e);
      long.expect = order - 1;
      continue;
    }
    const named = long && long.expect === 0 && checksum(e) === long.sum ? long : null;
    long = null;
    if ((attr & 0x18) === 0x08) {
      if (!label) label = cp437(e.subarray(0, 11)).trimEnd();
      continue;
    }
    if (attr & 0x08) continue;
    const name = named
      ? named.parts
          .join("")
          .replace(/\0[\s\S]*$/, "")
          .replace(/￿+$/, "")
      : shortName(e);
    if (name === "." || name === "..") continue;
    const high = fat32 ? u16(e, 20) * 0x10000 : 0;
    items.push({
      name: part(name),
      attr,
      cluster: high + u16(e, 26),
      size: attr & DIRECTORY ? 0 : u32(e, 28),
      date: dosDate(u16(e, 24), u16(e, 22)),
    });
  }
  return { items, label };
}

/** The BPB's own label, when its extended boot signature says it has one. @param {Uint8Array} b @param {boolean} fat32 */
function bpbLabel(b, fat32) {
  const o = fat32 ? 64 : 36;
  if (b[o + 2] !== 0x29) return "";
  const label = cp437(b.subarray(o + 7, o + 18)).trimEnd();
  return label === "NO NAME" ? "" : label;
}

/**
 * Open a FAT12, FAT16 or FAT32 volume.
 * @param {Source} source @param {Work} work @returns {Promise<import("./archive.js").FileSystem>}
 */
export async function openFat(source, work) {
  await work.tick();
  const b = await source.read(0, 512);
  const bad = (/** @type {string} */ what) => damaged(`The FAT boot sector is damaged: ${what}.`);
  if (b.length < 512) throw bad("the volume is shorter than one sector");
  const bps = u16(b, 11);
  const spc = b[13] ?? 0;
  const reserved = u16(b, 14);
  const fats = b[16] ?? 0;
  const rootEntries = u16(b, 17);
  const total = u16(b, 19) || u32(b, 32);
  const fat16 = u16(b, 22);
  const fatSize = fat16 || u32(b, 36);
  if (!pow2(bps) || bps < 512 || bps > 4096)
    throw bad(`${bps} bytes per sector is not a sector size`);
  if (!pow2(spc)) throw bad(`${spc} sectors per cluster is not a power of two`);
  if (!reserved) throw bad("it reserves no sectors for itself");
  if (!fats) throw bad("it has no file allocation table");
  if (!fatSize) throw bad("its file allocation table has no size");
  const rootSectors = Math.ceil((rootEntries * 32) / bps);
  const firstData = reserved + fats * fatSize + rootSectors;
  if (!total || firstData >= total) throw bad("its tables fill the whole volume");
  const fat32 = fat16 === 0;
  let count = Math.floor((total - firstData) / spc);
  const type = fat32 ? "FAT32" : count < 4085 ? "FAT12" : "FAT16";
  const bits = fat32 ? 32 : type === "FAT16" ? 16 : 12;
  count = Math.min(count, Math.floor((fatSize * bps * 8) / bits) - 2);
  if (count < 1) throw bad("its file allocation table has no room for clusters");
  const rootCluster = fat32 ? u32(b, 44) : 0;
  if (fat32 && (rootCluster < 2 || rootCluster > count + 1))
    throw bad("its root directory is outside the volume");

  const clusterBytes = bps * spc;
  const next = fatTable(source, reserved * bps, fatSize * bps, bits, "FAT");
  const options = {
    count,
    end: bits === 32 ? 0x0ffffff8 : bits === 16 ? 0xfff8 : 0xff8,
    mask: bits === 32 ? 0x0fffffff : 0xffffffff,
    work,
  };
  const offsetOf = (/** @type {number} */ c) => (firstData + (c - 2) * spc) * bps;

  /** A directory's bytes: the fixed root of FAT12 and FAT16, or a cluster chain. */
  const directory = async (/** @type {number} */ cluster, /** @type {Work} */ w) => {
    if (cluster === 0 && !fat32) {
      const bytes = new Uint8Array(rootEntries * 32);
      await readRange(source, (reserved + fats * fatSize) * bps, bytes.length, bytes, 0, w, "FAT");
      return bytes;
    }
    const most = Math.ceil(MOST_DIRECTORY / clusterBytes);
    const { clusters } = await chain(next, cluster || rootCluster, { ...options, most, work: w });
    const length = clusters.length * clusterBytes;
    return readClusters(source, offsetOf, clusterBytes, clusters, length, w, "FAT");
  };

  const root = parse(await directory(0, work), fat32);
  const label = root.label === "NO NAME" ? "" : root.label || bpbLabel(b, fat32);
  const used = await usedClusters(source, b, { bps, reserved, fatSize, count, bits, work });

  return {
    type,
    label,
    size: total * bps,
    used: used === undefined ? undefined : used * clusterBytes,
    details: [row("Cluster size", formatSize(clusterBytes))],
    async list(w) {
      /** @type {FileEntry[]} */
      const out = [];
      /** @type {{ path: string, items: Item[] }[]} */
      const stack = [{ path: "", items: root.items }];
      const seen = new Set([fat32 ? rootCluster : 0]);
      while (stack.length) {
        const { path, items } = /** @type {{ path: string, items: Item[] }} */ (stack.pop());
        await w.tick();
        for (const item of items) {
          const full = path ? `${path}/${item.name}` : item.name;
          const folder = !!(item.attr & DIRECTORY);
          const entry = {
            path: full,
            kind: folder ? "folder" : "file",
            size: item.size,
            ref: item,
          };
          out.push(/** @type {FileEntry} */ (item.date ? { ...entry, date: item.date } : entry));
          if (!folder || item.cluster < 2 || seen.has(item.cluster)) continue;
          seen.add(item.cluster);
          stack.push({ path: full, items: parse(await directory(item.cluster, w), fat32).items });
        }
      }
      return out;
    },
    async read(ref, limit, w) {
      const item = /** @type {Item} */ (ref);
      const want = Math.max(0, Math.min(limit, item.size));
      if (want === 0) return new Uint8Array(0);
      const most = Math.ceil(want / clusterBytes);
      const { clusters } = await chain(next, item.cluster, { ...options, most, work: w });
      if (clusters.length < most)
        throw damaged(`The FAT cluster chain of “${item.name}” ends before the file does.`);
      return readClusters(source, offsetOf, clusterBytes, clusters, want, w, "FAT");
    },
  };
}

/**
 * Clusters in use: counted in the table when it is at most 4 MiB, otherwise FAT32's FSInfo count
 * when it is valid.
 * @param {Source} source @param {Uint8Array} b the boot sector
 * @param {{ bps: number, reserved: number, fatSize: number, count: number, bits: number, work: Work }} geometry
 */
async function usedClusters(source, b, { bps, reserved, fatSize, count, bits, work }) {
  const bytes = Math.ceil(((count + 2) * bits) / 8);
  if (bytes <= 4 * 1024 * 1024 && bytes <= fatSize * bps) {
    const table = new Uint8Array(bytes);
    await readRange(source, reserved * bps, bytes, table, 0, work, "FAT");
    let used = 0;
    for (let n = 2; n < count + 2; n++) {
      let v;
      if (bits === 12) {
        const pair = u16(table, n + (n >> 1));
        v = n & 1 ? pair >> 4 : pair & 0xfff;
      } else v = bits === 16 ? u16(table, n * 2) : u32(table, n * 4) & 0x0fffffff;
      if (v) used++;
    }
    return used;
  }
  if (bits !== 32) return undefined;
  const info = await source.read(u16(b, 48) * bps, 512);
  if (u32(info, 0) !== 0x41615252 || u32(info, 484) !== 0x61417272) return undefined;
  const free = u32(info, 488);
  return free <= count ? count - free : undefined;
}
