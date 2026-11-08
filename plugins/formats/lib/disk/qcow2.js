// QCOW2 (the format QEMU's docs/interop/qcow2.txt describes), versions 2 and 3: a big-endian
// header, an L1 table of L2 tables of cluster descriptors: a host offset, the zero flag, or a
// raw-deflate compressed cluster. Extended L2 entries split a cluster into 32 subclusters. Backing
// files, external data files, encryption and Zstandard clusters are refused with a sentence.
import { row } from "./archive.js";
import { at, big64be, formatSize, latin1, sizeDetail, u32be, u64be } from "./bytes.js";
import { inflateRaw } from "./inflate.js";
import { lru } from "./lru.js";
import { extentSource, readExact } from "./source.js";
import { damaged, Refusal } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */

const FORMAT = "QCOW2";
const DIRTY = 1n;
const CORRUPT = 2n;
const EXTERNAL_DATA = 4n;
const COMPRESSION_TYPE = 8n;
const EXTENDED_L2 = 16n;
const KNOWN = DIRTY | CORRUPT | EXTERNAL_DATA | COMPRESSION_TYPE | EXTENDED_L2;
const OFFSET_MASK = 0x00fffffffffffe00n; // bits 9 to 55
const COMPRESSED = 1n << 62n;
const ZSTD = "This QCOW2 image compresses clusters with Zstandard, which is not read here.";

/**
 * @param {Source} source
 * @returns {Promise<import("./containers.js").Container>}
 */
export async function openQcow2(source) {
  const head = await readExact(source, 0, Math.min(source.size, 4096), "The QCOW2 header");
  if (!at(head, 0, "QFI\xfb") || head.length < 72) throw damaged("The QCOW2 header is damaged.");
  const version = u32be(head, 4);
  const size = u64be(head, 24);
  /** @type {Detail[]} */
  const details = [row("Virtual size", sizeDetail(size)), row("Version", version)];
  if (version < 2) throw new Refusal("QCOW version 1 images are not read here.", FORMAT, details);
  if (version > 3)
    throw new Refusal(`QCOW2 version ${version} images are not read here.`, FORMAT, details);
  const clusterBits = u32be(head, 20);
  if (clusterBits < 9 || clusterBits > 21)
    throw damaged("The QCOW2 header is damaged: its cluster size is not possible.");
  const cluster = 2 ** clusterBits;
  details.push(row("Cluster size", formatSize(cluster)));
  const incompatible = version >= 3 ? big64be(head, 72) : 0n;
  const headerLength = version >= 3 ? u32be(head, 100) : 72;
  const zstd = !!(incompatible & COMPRESSION_TYPE) && headerLength > 104 && head[104] === 1;
  details.push(row("Compression", zstd ? "Zstandard" : "zlib"));
  const snapshots = u32be(head, 60);
  if (snapshots) details.push(row("Snapshots", `${snapshots} (the current state is read)`));
  if (incompatible & CORRUPT)
    details.push(row("State", "Marked corrupt; the image is read as it is."));
  else if (incompatible & DIRTY)
    details.push(row("State", "Not closed cleanly; the image is read as it is."));
  const backingOffset = u64be(head, 8);
  const backingLength = u32be(head, 16);
  if (backingOffset && backingLength) {
    const name = latin1(await source.read(backingOffset, Math.min(backingLength, 1023)));
    details.push(row("Backing file", name));
    throw new Refusal(
      `The image keeps its unchanged data in its backing file “${name}”, which is not read here.`,
      FORMAT,
      details,
    );
  }
  if (u32be(head, 32))
    throw new Refusal("This QCOW2 image is encrypted, which is not read here.", FORMAT, details);
  if (incompatible & EXTERNAL_DATA)
    throw new Refusal(
      "This QCOW2 image keeps its data in an external data file, which is not read here.",
      FORMAT,
      details,
    );
  if (incompatible & ~KNOWN)
    throw new Refusal("This QCOW2 image uses features that are not read here.", FORMAT, details);
  const extended = !!(incompatible & EXTENDED_L2);
  const entryBytes = extended ? 16 : 8;
  const perTable = cluster / entryBytes;
  const l1Size = u32be(head, 36);
  if (l1Size * perTable * cluster < size)
    throw damaged("The QCOW2 header is damaged: its L1 table is too small for the disk.");
  const l1 = await readExact(source, u64be(head, 40), l1Size * 8, "The QCOW2 L1 table");
  const table = lru(32, (/** @type {number} */ offset) =>
    readExact(source, offset, cluster, "A QCOW2 L2 table"),
  );
  const shift = BigInt(62 - (clusterBits - 8));
  const hostMask = (1n << shift) - 1n;
  const decoded = lru(16, async (/** @type {bigint} */ entry) => {
    if (zstd) throw new Refusal(ZSTD, FORMAT, details);
    const offset = Number(entry & hostMask);
    const sectors = Number((entry & ((1n << 62n) - 1n)) >> shift);
    const length = Math.min((sectors + 1) * 512 - (offset % 512), source.size - offset);
    const packed = await readExact(
      source,
      offset,
      Math.max(0, length),
      "A QCOW2 compressed cluster",
    );
    let data;
    try {
      data = inflateRaw(packed, 0, cluster).data;
    } catch {
      throw damaged("A QCOW2 cluster's compressed data is damaged.");
    }
    if (data.length < cluster)
      throw damaged("A QCOW2 cluster's compressed data is damaged: it is short.");
    return data.subarray(0, cluster);
  });
  const sub = cluster / 32;
  const disk = extentSource(
    source,
    size,
    async (offset) => {
      const index = Math.floor(offset / cluster);
      const within = offset - index * cluster;
      const rest = Math.min(cluster - within, size - offset);
      const l2 = Number(big64be(l1, Math.floor(index / perTable) * 8) & OFFSET_MASK);
      if (!l2) return { length: rest };
      const entries = await table(l2);
      const at = (index % perTable) * entryBytes;
      const entry = big64be(entries, at);
      if (entry & COMPRESSED) {
        const bytes = await decoded(entry & ~(1n << 63n));
        return { bytes: bytes.subarray(within), length: rest };
      }
      const host = Number(entry & OFFSET_MASK);
      if (!extended)
        return entry & 1n || !host ? { length: rest } : { at: host + within, length: rest };
      // Extended L2: 32 subclusters, each allocated (low half) or reading as zeros (high half).
      const bitmap = big64be(entries, at + 8);
      const first = Math.floor(within / sub);
      const state = (/** @type {number} */ i) =>
        (bitmap >> BigInt(32 + i)) & 1n ? 0 : (bitmap >> BigInt(i)) & 1n && host ? 1 : 0;
      const kind = state(first);
      let last = first + 1;
      while (last < 32 && state(last) === kind) last++;
      const length = Math.min(rest, last * sub - within);
      return kind ? { at: host + within, length } : { length };
    },
    FORMAT,
  );
  return { format: FORMAT, details, disk };
}
