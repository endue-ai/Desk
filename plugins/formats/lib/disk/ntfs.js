// NTFS, read only, from the public NTFS documentation: the boot sector's geometry, the MFT read
// in chunks, every in-use file record with its extension records joined to it, and the tree built
// from the parent references in the file names. Files with several names (hard links) are listed
// once, alternate data streams are left out, metadata files are hidden. Symbolic links are reparse
// points or Interix links (what ntfs-3g writes).

import { ENCRYPTED, part, row } from "./archive.js";
import { at, fileTime, formatSize, u16, u32, u64, utf16le } from "./bytes.js";
import { readStream } from "./ntfs-data.js";
import {
  ATTRIBUTE_LIST,
  DATA,
  FILE_NAME,
  parseRecord,
  REPARSE_POINT,
  recordNumber,
  STANDARD_INFORMATION,
  streamOf,
  unnamed,
  VOLUME_INFORMATION,
  VOLUME_NAME,
} from "./ntfs-records.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./work.js").Work} Work */
/** @typedef {import("./archive.js").FileEntry} FileEntry */
/** @typedef {import("./archive.js").FileSystem} FileSystem */
/** @typedef {import("./ntfs-records.js").MftRecord} MftRecord */
/** @typedef {import("./ntfs-records.js").Attribute} Attribute */
/** @typedef {import("./ntfs-records.js").Stream} Stream */
/**
 * @typedef {{ name: string, parent: number, parentSeq: number, seq: number, isDir: boolean,
 *   date?: Date, attributes: number, data?: Stream, reparse?: Uint8Array }} Node
 */

const ROOT = 5;
const KEEP = new Set([STANDARD_INFORMATION, FILE_NAME, DATA, REPARSE_POINT]);
const CHUNK = 2 * 1024 * 1024;
const BITMAP_MOST = 8 * 1024 * 1024;
const BOOT = "The NTFS boot sector is damaged: its geometry is impossible.";
const WOF = "Compressed by Windows (WOF or deduplication): not extracted.";

const power = (/** @type {number} */ n) => n > 0 && (n & (n - 1)) === 0;
/** A signed byte. @param {number} b */
const signed = (b) => (b > 127 ? b - 256 : b);

/** @param {Uint8Array} boot */
function geometry(boot) {
  const sector = u16(boot, 11);
  const raw = boot[13] ?? 0;
  const perCluster = raw > 0x80 ? 2 ** (256 - raw) : raw;
  const cluster = sector * perCluster;
  const perRecord = signed(boot[0x40] ?? 0);
  const record = perRecord > 0 ? perRecord * cluster : 2 ** -perRecord;
  const total = u64(boot, 0x28) * sector;
  const mft = u64(boot, 0x30) * cluster;
  const valid =
    [256, 512, 1024, 2048, 4096].includes(sector) &&
    power(perCluster) &&
    cluster <= 2 * 1024 * 1024 &&
    power(record) &&
    record >= 256 &&
    record <= 65536 &&
    total > 0;
  if (!valid) throw damaged(BOOT);
  return { cluster, record, total, mft };
}

/**
 * @param {Source} volume @param {Work} work @returns {Promise<FileSystem>}
 */
export async function openNtfs(volume, work) {
  await work.tick();
  const boot = await volume.read(0, 512);
  if (!at(boot, 3, "NTFS    ")) throw damaged("The NTFS boot sector is damaged.");
  const { cluster, record: size, total, mft: mftAt } = geometry(boot);
  const lost = "The NTFS MFT is damaged: its first record is not where the boot sector says.";
  if (mftAt + size > volume.size) throw damaged(lost);
  const zero = parseRecord((await volume.read(mftAt, size)).slice());
  if (!zero?.inUse) throw damaged(lost);
  const mft = await mftStream(volume, cluster, size, zero, work);
  const record = async (/** @type {number} */ n) =>
    parseRecord(await readStream(volume, cluster, mft, n * size, size, work));

  const info = await record(3);
  const label = utf16le(unnamed(info ?? zero, VOLUME_NAME)[0]?.value ?? new Uint8Array(0));
  const version = unnamed(info ?? zero, VOLUME_INFORMATION)[0]?.value;
  const bitmap = streamOf(unnamed((await record(6)) ?? zero, DATA));
  let used;
  if (bitmap && bitmap.size <= BITMAP_MOST) {
    const bits = await readStream(volume, cluster, bitmap, 0, bitmap.size, work);
    const clusters = Math.floor(total / cluster);
    let set = 0;
    for (let i = 0; i < bits.length && i * 8 < clusters; i++) {
      let b = bits[i] ?? 0;
      if ((i + 1) * 8 > clusters) b &= (1 << (clusters - i * 8)) - 1;
      for (; b; b &= b - 1) set++;
    }
    used = set * cluster;
  }
  const details = [row("Cluster size", formatSize(cluster))];
  if (version) details.unshift(row("NTFS version", `${version[8] ?? 0}.${version[9] ?? 0}`));
  return {
    type: "NTFS",
    label,
    size: total,
    used,
    details,
    list: (w) => list(volume, cluster, size, mft, w),
    read: (ref, limit, w) => {
      const data = /** @type {Stream} */ (ref);
      return readStream(volume, cluster, data, 0, Math.min(limit, data.size), w);
    },
  };
}

/**
 * The $MFT's own data: its runs in record 0 and, for a fragmented MFT, in the extension records
 * its attribute list names.
 * @param {Source} volume @param {number} cluster @param {number} size @param {MftRecord} zero @param {Work} work
 */
async function mftStream(volume, cluster, size, zero, work) {
  const fragments = unnamed(zero, DATA);
  let stream = streamOf(fragments);
  if (!stream || stream.resident || stream.size < size)
    throw damaged("The NTFS MFT is damaged: its first record has no data.");
  const list = streamOf(unnamed(zero, ATTRIBUTE_LIST));
  if (list) {
    const bytes = await readStream(volume, cluster, list, 0, list.size, work);
    const seen = new Set([0]);
    for (let o = 0; o + 26 <= bytes.length; ) {
      const length = u16(bytes, o + 4);
      if (length < 26) break;
      const n = recordNumber(bytes, o + 16);
      if (u32(bytes, o) === DATA && !bytes[o + 6] && !seen.has(n)) {
        seen.add(n);
        const extension = parseRecord(
          await readStream(volume, cluster, stream, n * size, size, work),
        );
        if (extension) fragments.push(...unnamed(extension, DATA));
        stream = /** @type {Stream} */ (streamOf(fragments));
      }
      o += length;
    }
  }
  return stream;
}

/** The node a base record (with its extensions' attributes) makes. @param {MftRecord} record @param {Attribute[]} more */
function nodeOf(record, more) {
  const attributes = more.length ? [...record.attributes, ...more] : record.attributes;
  let name;
  for (const a of attributes) {
    if (a.type !== FILE_NAME || !a.value || a.value.length < 66) continue;
    const space = a.value[65] ?? 0;
    if (space === 2 && name) continue;
    const fileName = { a, space };
    if (!name || name.space === 2) name = fileName;
    if (space !== 2) break;
  }
  if (!name) return undefined;
  const v = /** @type {Uint8Array} */ (name.a.value);
  const si = attributes.find((a) => a.type === STANDARD_INFORMATION)?.value;
  return /** @type {Node} */ ({
    name: utf16le(v.subarray(66, 66 + (v[64] ?? 0) * 2)),
    parent: recordNumber(v, 0),
    parentSeq: u16(v, 6),
    seq: record.seq,
    isDir: record.isDir,
    date: si && si.length >= 16 ? fileTime(si, 8) : fileTime(v, 16),
    attributes: si && si.length >= 36 ? u32(si, 32) : u32(v, 56),
    data: streamOf(attributes.filter((a) => a.type === DATA && a.name === "")),
    reparse: attributes.find((a) => a.type === REPARSE_POINT)?.value,
  });
}

/**
 * Every in-use record of the MFT, read in chunks, as nodes by record number.
 * @param {Source} volume @param {number} cluster @param {number} size @param {Stream} mft @param {Work} work
 */
async function scan(volume, cluster, size, mft, work) {
  /** @type {Map<number, MftRecord>} */
  const bases = new Map();
  /** @type {Map<number, Attribute[]>} */
  const extensions = new Map();
  const count = Math.floor(mft.size / size);
  const per = Math.max(1, Math.floor(CHUNK / size));
  for (let first = 0; first < count; first += per) {
    const n = Math.min(per, count - first);
    const bytes = await readStream(volume, cluster, mft, first * size, n * size, work);
    await work.tick();
    for (let i = 0; i < n; i++) {
      const record = parseRecord(bytes.subarray(i * size, (i + 1) * size), KEEP);
      if (!record?.inUse) continue;
      if (!record.base) bases.set(first + i, record);
      else {
        const list = extensions.get(record.base) ?? [];
        list.push(...record.attributes);
        extensions.set(record.base, list);
      }
      if ((i & 255) === 255) await work.tick();
    }
  }
  /** @type {Map<number, Node>} */
  const nodes = new Map();
  let done = 0;
  for (const [n, record] of bases) {
    const node = nodeOf(record, extensions.get(n) ?? []);
    if (node) nodes.set(n, node);
    if (++done % 4096 === 0) await work.tick();
  }
  return nodes;
}

/** A reparse point's target, "/" separated, or undefined when it is no link. @param {Uint8Array} b */
function reparseTarget(b) {
  const tag = u32(b, 0);
  if (tag !== 0xa000000c && tag !== 0xa0000003) return undefined;
  const buffer = tag === 0xa000000c ? 20 : 16;
  const name = (/** @type {number} */ o) =>
    utf16le(b.subarray(buffer + u16(b, o), buffer + u16(b, o) + u16(b, o + 2)));
  const target = name(12) || name(8).replace(/^\\\?\?\\/, "");
  return target.replace(/\\/g, "/");
}

/**
 * The files, folders and links under the root.
 * @param {Source} volume @param {number} cluster @param {number} size @param {Stream} mft @param {Work} work
 * @returns {Promise<FileEntry[]>}
 */
async function list(volume, cluster, size, mft, work) {
  const nodes = await scan(volume, cluster, size, mft, work);
  /** @type {Map<number, number[]>} */
  const children = new Map();
  let done = 0;
  for (const [n, node] of nodes) {
    if (++done % 4096 === 0) await work.tick();
    if (n === ROOT || (n < 24 && node.attributes & 0x4) || n < 16) continue;
    const parent = nodes.get(node.parent);
    if (!parent?.isDir || (node.parentSeq && parent.seq && node.parentSeq !== parent.seq)) continue;
    if (node.parent === ROOT && node.name.startsWith("$")) continue;
    const list = children.get(node.parent) ?? [];
    list.push(n);
    children.set(node.parent, list);
  }
  /** @type {FileEntry[]} */
  const entries = [];
  /** @type {[number, string][]} */
  const queue = [[ROOT, ""]];
  const seen = new Set([ROOT]);
  for (let i = 0; i < queue.length; i++) {
    const [folder, prefix] = /** @type {[number, string]} */ (queue[i]);
    const names = (children.get(folder) ?? []).map((n) => ({
      n,
      node: /** @type {Node} */ (nodes.get(n)),
    }));
    names.sort((a, b) => (a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0));
    for (const { n, node } of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      const path = `${prefix}${part(node.name)}`;
      const entry = await entryOf(volume, cluster, node, path, work);
      entries.push(entry);
      if (entry.kind === "folder") queue.push([n, `${path}/`]);
    }
    await work.tick();
  }
  return entries;
}

/** @param {Source} volume @param {number} cluster @param {Node} node @param {string} path @param {Work} work @returns {Promise<FileEntry>} */
async function entryOf(volume, cluster, node, path, work) {
  const common = { path, date: node.date, ref: node.data };
  const target = node.reparse ? reparseTarget(node.reparse) : undefined;
  if (target !== undefined)
    return { ...common, kind: "link", size: new TextEncoder().encode(target).length, link: target };
  if (node.isDir) return { ...common, kind: "folder", size: 0 };
  const data = node.data;
  const size = data?.size ?? 0;
  if (data && node.attributes & 0x4 && size >= 10 && size < 8192) {
    const head = await readStream(volume, cluster, data, 0, size, work);
    if (at(head, 0, "IntxLNK\x01")) {
      const link = utf16le(head.subarray(8)).replace(/\0[\s\S]*$/, "");
      return { ...common, kind: "link", size: new TextEncoder().encode(link).length, link };
    }
  }
  /** @type {FileEntry} */
  const entry = { ...common, kind: "file", size };
  if (data && !data.resident && (data.compressed || data.sparse))
    entry.packed = data.compressedSize ?? data.allocated;
  if (data?.compressed) entry.method = "LZNT1";
  if (node.attributes & 0x4000 || data?.encrypted) {
    entry.encrypted = true;
    entry.refusal = ENCRYPTED;
  } else if (node.reparse && [0x80000017, 0x80000013].includes(u32(node.reparse, 0)))
    entry.refusal = WOF;
  return entry;
}
