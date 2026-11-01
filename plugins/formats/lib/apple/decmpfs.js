// decmpfs: the files macOS keeps compressed, on HFS+ and APFS alike. The com.apple.decmpfs
// attribute starts with a 16-byte header ("fpmc", the type, the decoded size, little-endian);
// small files keep their compressed bytes after it, larger ones in the resource fork, in blocks of
// 64 KiB. Types: 1 and 9 stored, 3 and 4 zlib, 7 and 8 LZVN, 11 and 12 LZFSE (odd in the
// attribute, even in the fork, except 1); 13 and 14 (LZBITMAP) and the rest are named, not read.
import { u32, u64 } from "../disk/bytes.js";
import { inflateZlib } from "../disk/inflate.js";
import { damaged } from "../disk/work.js";
import { decodeLzfse } from "./lzfse.js";
import { decodeLzvn } from "./lzvn.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/** @typedef {{ type: number, size: number }} Header */

export const DECMPFS = "com.apple.decmpfs";
export const RESOURCE_FORK = "com.apple.ResourceFork";
const BLOCK = 64 * 1024;

const METHODS = /** @type {Record<number, string>} */ ({
  1: "Stored",
  3: "zlib",
  4: "zlib",
  7: "LZVN",
  8: "LZVN",
  9: "Stored",
  10: "Stored",
  11: "LZFSE",
  12: "LZFSE",
  13: "LZBITMAP",
  14: "LZBITMAP",
});
const READ = new Set([1, 3, 4, 7, 8, 9, 10, 11, 12]);
const IN_FORK = new Set([4, 8, 10, 12, 14]);

/** The attribute's header, or undefined when it is not one. @param {Uint8Array} attr @returns {Header | undefined} */
export function decmpfsHeader(attr) {
  if (attr.length < 16 || u32(attr, 0) !== 0x636d7066) return undefined;
  return { type: u32(attr, 4), size: u64(attr, 8) };
}

/** "LZFSE (decmpfs)", the method an entry shows. @param {Header} header */
export const decmpfsMethod = (header) =>
  `${METHODS[header.type] ?? `type ${header.type}`} (decmpfs)`;

/** Whether the compressed bytes are in the resource fork. @param {Header} header */
export const decmpfsInFork = (header) => IN_FORK.has(header.type);

/** Why the file cannot be read, or undefined when it can. @param {Header} header */
export function decmpfsRefusal(header) {
  if (READ.has(header.type)) return undefined;
  const name = METHODS[header.type];
  return name
    ? `The file is compressed with ${name}, which is not read here.`
    : `The file is compressed in a way (decmpfs type ${header.type}) that is not read here.`;
}

/**
 * One compressed piece, `size` bytes decoded: stored pieces start with a marker byte (0xFF for
 * zlib, 0x06 for LZVN, a byte before raw bytes for the stored types).
 * @param {number} type @param {Uint8Array} bytes @param {number} size
 */
function piece(type, bytes, size) {
  const method = METHODS[type];
  if (method === "Stored") return bytes.length > size ? bytes.subarray(1, 1 + size) : bytes;
  if (method === "zlib") {
    if (((bytes[0] ?? 0) & 0x0f) === 0x0f) return bytes.subarray(1, 1 + size);
    return inflateZlib(bytes, size);
  }
  if (method === "LZVN") {
    if (bytes[0] === 0x06) return bytes.subarray(1, 1 + size);
    return decodeLzvn(bytes, size);
  }
  if (bytes[0] !== 0x62 && bytes.length === size + 1) return bytes.subarray(1);
  return decodeLzfse(bytes, size);
}

/** Exactly `length` bytes at `offset` of the fork. @param {Source} fork @param {number} offset @param {number} length */
async function forkBytes(fork, offset, length) {
  const bytes = await fork.read(offset, length);
  if (bytes.length < length) throw damaged("A compressed file's resource fork is cut short.");
  return bytes;
}

/**
 * Where each block of a fork lies: zlib forks hold a resource ('cmpf') with a table of offsets and
 * sizes, the others a table of offsets, one more than there are blocks.
 * @param {number} type @param {Source} fork @param {number} count
 * @returns {Promise<{ at: number, length: number }[]>}
 */
async function forkBlocks(type, fork, count) {
  /** @type {{ at: number, length: number }[]} */
  const blocks = [];
  if (METHODS[type] === "zlib") {
    const head = await forkBytes(fork, 0, 16);
    const data = ((head[0] ?? 0) << 24) | ((head[1] ?? 0) << 16) | ((head[2] ?? 0) << 8);
    const base = (data | (head[3] ?? 0)) + 4;
    const table = await forkBytes(fork, base, 4 + 8 * count);
    if (u32(table, 0) < count) throw damaged("A compressed file's block table is too short.");
    for (let i = 0; i < count; i++)
      blocks.push({ at: base + u32(table, 4 + 8 * i), length: u32(table, 8 + 8 * i) });
  } else {
    const table = await forkBytes(fork, 0, 4 * (count + 1));
    for (let i = 0; i < count; i++) {
      const at = u32(table, 4 * i);
      blocks.push({ at, length: u32(table, 4 * i + 4) - at });
    }
  }
  for (const block of blocks)
    if (block.length < 0 || block.length > 2 * BLOCK + 64 || block.at + block.length > fork.size)
      throw damaged("A compressed file's block table points outside its resource fork.");
  return blocks;
}

/**
 * The first `limit` bytes of a compressed file.
 * @param {Uint8Array} attr the com.apple.decmpfs attribute @param {Source | undefined} fork the
 * resource fork, for the types that keep their data there @param {number} limit @param {Work} work
 */
export async function decmpfsRead(attr, fork, limit, work) {
  const header = decmpfsHeader(attr);
  if (!header) throw damaged("A compressed file's decmpfs header is damaged.");
  const refusal = decmpfsRefusal(header);
  if (refusal) throw new Error(refusal);
  const want = Math.min(limit, header.size);
  if (want <= 0) return new Uint8Array(0);
  if (!decmpfsInFork(header)) {
    const bytes = piece(header.type, attr.subarray(16), header.size);
    if (bytes.length < want)
      throw damaged("A compressed file decodes to fewer bytes than its size.");
    return bytes.subarray(0, want);
  }
  if (!fork) throw damaged("A compressed file has no resource fork to read its data from.");
  const count = Math.ceil(header.size / BLOCK);
  const needed = Math.ceil(want / BLOCK);
  const blocks = await forkBlocks(header.type, fork, count);
  const out = new Uint8Array(want);
  for (let i = 0; i < needed; i++) {
    await work.tick();
    const block = /** @type {{ at: number, length: number }} */ (blocks[i]);
    const size = Math.min(BLOCK, header.size - i * BLOCK);
    const bytes = piece(header.type, await forkBytes(fork, block.at, block.length), size);
    if (bytes.length < Math.min(size, want - i * BLOCK))
      throw damaged("A compressed file decodes to fewer bytes than its size.");
    out.set(bytes.subarray(0, Math.min(size, want - i * BLOCK)), i * BLOCK);
  }
  return out;
}
