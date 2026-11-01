// WIM resources: a header names where a resource is stored, its stored and original sizes and its
// flags; a compressed resource is a table of chunk offsets and then chunks of the WIM's chunk size,
// each XPRESS or LZX on its own (or stored as it is when compressing did not make it smaller).
import { u32, u64 } from "../disk/bytes.js";
import { lzxWim } from "./lzx.js";
import { xpressHuffman } from "./xpress.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/**
 * @typedef {{ size: number, flags: number, offset: number, original: number }} Resource
 * `size` is what the file holds, `original` the decoded size.
 */

export const FREE = 1;
export const METADATA = 2;
export const COMPRESSED = 4;
export const SPANNED = 8;
export const SOLID = 0x10;

export const LZMS = "LZMS compression is not read yet.";

/** A resource header: 7 bytes of stored size, a flags byte, the offset and the original size. @param {Uint8Array} b @param {number} o */
export function resourceAt(b, o) {
  return /** @type {Resource} */ ({
    size: u32(b, o) + ((b[o + 4] ?? 0) + (b[o + 5] ?? 0) * 256 + (b[o + 6] ?? 0) * 65536) * 2 ** 32,
    flags: b[o + 7] ?? 0,
    offset: u64(b, o + 8),
    original: u64(b, o + 16),
  });
}

/** The compression the WIM header's flags name. @param {number} flags */
export function compressionOf(flags) {
  if (!(flags & 2)) return "None";
  if (flags & 0x40000) return "LZX";
  if (flags & 0x20000) return "XPRESS";
  if (flags & 0x80000) return "LZMS";
  return "Unknown";
}

/**
 * Why a resource cannot be read here, or "" when it can.
 * @param {Resource} res @param {string} compression
 */
export function refusalOf(res, compression) {
  if (res.flags & SOLID) return LZMS;
  if (!(res.flags & COMPRESSED)) return "";
  if (compression === "LZMS") return LZMS;
  if (compression === "XPRESS" || compression === "LZX") return "";
  return "This WIM's compression is not known.";
}

/**
 * `load(key)` behind a map of the last `limit` keys; a failed load is forgotten.
 * @template T
 * @param {Map<string | number, Promise<T>>} kept @param {number} limit @param {string | number} key
 * @param {() => Promise<T>} load
 */
function remember(kept, limit, key, load) {
  let got = kept.get(key);
  if (got) kept.delete(key);
  else {
    got = load();
    got.catch(() => kept.delete(key));
  }
  kept.set(key, got);
  while (kept.size > limit) kept.delete(/** @type {string | number} */ (kept.keys().next().value));
  return got;
}

/**
 * Reads resources of one WIM by byte ranges of their decoded data, decoding only the chunks a
 * range needs and keeping the last few decoded (8 MiB of them).
 */
export class Resources {
  /** @param {Source} source @param {string} compression @param {number} chunk the chunk size */
  constructor(source, compression, chunk) {
    this.source = source;
    this.compression = compression;
    this.chunk = chunk;
    /** @type {Map<string | number, Promise<{ head: number, starts: number[] }>>} */
    this.tables = new Map();
    /** @type {Map<string | number, Promise<Uint8Array>>} */
    this.decoded = new Map();
    this.keep = Math.max(4, Math.floor((8 << 20) / chunk));
  }

  /** @param {Resource} res @param {number} at @param {number} length @param {string} what */
  async raw(res, at, length, what) {
    if (res.offset + res.size > this.source.size)
      throw new Error(`The WIM is cut short: ${what} goes past the end of the file.`);
    const bytes = await this.source.read(res.offset + at, length);
    if (bytes.length < length)
      throw new Error(`The WIM is cut short: ${what} goes past the end of the file.`);
    return bytes;
  }

  /** The chunk offsets of a compressed resource, from the start of its first chunk. @param {Resource} res */
  async table(res) {
    const count = Math.ceil(res.original / this.chunk);
    const width = res.original > 0xffffffff ? 8 : 4;
    if ((count - 1) * width > res.size)
      throw new Error("The WIM is damaged: a resource's chunk table is larger than the resource.");
    const bytes = await this.raw(res, 0, (count - 1) * width, "a chunk table");
    const head = (count - 1) * width;
    const starts = new Array(count + 1);
    starts[0] = 0;
    for (let i = 1; i < count; i++)
      starts[i] = width === 8 ? u64(bytes, (i - 1) * 8) : u32(bytes, (i - 1) * 4);
    starts[count] = res.size - head;
    for (let i = 0; i < count; i++)
      if (starts[i] > starts[i + 1])
        throw new Error("The WIM is damaged: a resource's chunk table is out of order.");
    return { head, starts };
  }

  /** @param {Resource} res @param {number} index */
  async decodeChunk(res, index) {
    const { head, starts } = await remember(this.tables, 32, res.offset, () => this.table(res));
    const stored = starts[index + 1] - starts[index];
    const original = Math.min(this.chunk, res.original - index * this.chunk);
    const bytes = await this.raw(res, head + starts[index], stored, "a chunk");
    if (stored === original) return bytes;
    if (this.compression === "LZX") return lzxWim(bytes, original, Math.max(32768, this.chunk));
    return xpressHuffman(bytes, original);
  }

  /**
   * Bytes `at` to `at + length` of the resource's decoded data.
   * @param {Resource} res @param {number} at @param {number} length @param {Work} work @param {string} [what]
   */
  async read(res, at, length, work, what = "a resource") {
    const end = Math.min(res.original, at + length);
    if (end <= at) return new Uint8Array(0);
    if (!(res.flags & COMPRESSED)) {
      if (res.size < res.original) throw new Error(`The WIM is damaged: ${what} is cut short.`);
      return this.raw(res, at, end - at, what);
    }
    const why = refusalOf(res, this.compression);
    if (why) throw new Error(why);
    const chunk = this.chunk;
    const out = new Uint8Array(end - at);
    for (let index = Math.floor(at / chunk); index * chunk < end; index++) {
      await work.tick();
      const bytes = await remember(this.decoded, this.keep, `${res.offset}:${index}`, () =>
        this.decodeChunk(res, index),
      );
      const from = Math.max(at, index * chunk);
      const to = Math.min(end, index * chunk + bytes.length);
      out.set(bytes.subarray(from - index * chunk, to - index * chunk), from - at);
    }
    await work.tick();
    return out;
  }
}
