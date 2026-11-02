// A UDIF disk as a Source over its chunks: runs of sectors that are zeros, stored raw, or
// compressed with ADC, zlib, bzip2, LZFSE or LZMA. A chunk is decoded whole the first time a read
// touches it and kept while it is among the last 64 MiB decoded; raw runs are read straight from
// the image. Long reads give the event loop a turn every 25 ms.
import { decode } from "../codecs/index.js";
import { inflateZlib } from "../disk/inflate.js";
import { damaged, Work } from "../disk/work.js";
import { decodeAdc } from "./adc.js";
import { decodeLzfse } from "./lzfse.js";

/** @typedef {import("../disk/source.js").Source} Source */
/**
 * @typedef {{ start: number, end: number, type: number, at: number, length: number }} Chunk
 * `start` and `end` in bytes on the disk, `at` and `length` the chunk's bytes in the image.
 */

export const ZERO = 0x00000000;
export const RAW = 0x00000001;
export const IGNORE = 0x00000002;
export const ADC = 0x80000004;
export const ZLIB = 0x80000005;
export const BZIP2 = 0x80000006;
export const LZFSE = 0x80000007;
export const LZMA = 0x80000008;
export const COMMENT = 0x7ffffffe;
export const END = 0xffffffff;

/** The methods by chunk type, as details name them. */
export const METHODS = /** @type {Record<number, string>} */ ({
  [RAW]: "raw",
  [ADC]: "ADC",
  [ZLIB]: "zlib",
  [BZIP2]: "bzip2",
  [LZFSE]: "LZFSE",
  [LZMA]: "LZMA",
});
const KEEP = 64 * 1024 * 1024;

/** Decode one chunk's bytes into the `size` bytes it covers. @param {Chunk} chunk @param {Uint8Array} bytes */
async function decodeChunk(chunk, bytes) {
  const size = chunk.end - chunk.start;
  const name = METHODS[chunk.type] ?? "unknown";
  const sector = chunk.start / 512;
  /** @type {Uint8Array} */
  let out;
  try {
    if (chunk.type === ZLIB) {
      try {
        out = await decode("zlib", bytes, undefined, size);
      } catch {
        // The platform's decoder refuses bytes after the stream's end; this one stops there.
        out = inflateZlib(bytes, size);
      }
    } else if (chunk.type === BZIP2) out = await decode("bzip2", bytes, undefined, size);
    else if (chunk.type === LZMA) {
      const xz = bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a;
      out = await decode(xz ? "xz" : "lzma", bytes, undefined, size);
    } else if (chunk.type === LZFSE) out = decodeLzfse(bytes, size);
    else if (chunk.type === ADC) out = decodeAdc(bytes, size);
    else throw new Error(`chunks of type 0x${chunk.type.toString(16)} are not known`);
  } catch (error) {
    const why = error instanceof Error ? error.message.replace(/\.$/, "") : String(error);
    throw damaged(
      `The disk image is damaged: its ${name} chunk at sector ${sector} does not decode (${why}).`,
    );
  }
  if (out.length < size)
    throw damaged(
      `The disk image is damaged: its ${name} chunk at sector ${sector} decodes to fewer bytes than it covers.`,
    );
  return out.length === size ? out : out.subarray(0, size);
}

/**
 * The disk the chunks describe; sectors no chunk covers read as zeros.
 * @param {Source} image @param {Chunk[]} chunks sorted by `start` @param {number} size the disk's size
 * @returns {Source}
 */
export function chunkSource(image, chunks, size) {
  /** @type {Map<number, Promise<Uint8Array>>} */
  const cache = new Map();
  /** @type {Map<number, number>} */
  const sizes = new Map();
  let kept = 0;
  /** The chunk that holds `pos`, or the index of the next one as -(index + 1). @param {number} pos */
  const find = (pos) => {
    let lo = 0;
    let hi = chunks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = /** @type {Chunk} */ (chunks[mid]);
      if (pos < c.start) hi = mid - 1;
      else if (pos >= c.end) lo = mid + 1;
      else return mid;
    }
    return -(lo + 1);
  };
  /** @param {number} index */
  const decoded = (index) => {
    let got = cache.get(index);
    if (got) {
      cache.delete(index);
      cache.set(index, got);
      return got;
    }
    const chunk = /** @type {Chunk} */ (chunks[index]);
    got = image.read(chunk.at, chunk.length).then((bytes) => {
      if (bytes.length < chunk.length)
        throw damaged("The disk image is cut short: its data goes past the end of the file.");
      return decodeChunk(chunk, bytes);
    });
    got.catch(() => {
      cache.delete(index);
      kept -= sizes.get(index) ?? 0;
      sizes.delete(index);
    });
    cache.set(index, got);
    sizes.set(index, chunk.end - chunk.start);
    kept += chunk.end - chunk.start;
    for (const [old] of cache) {
      if (kept <= KEEP || cache.size <= 2) break;
      cache.delete(old);
      kept -= sizes.get(old) ?? 0;
      sizes.delete(old);
    }
    return got;
  };
  return {
    size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(offset, size));
      const end = Math.min(size, start + Math.max(0, length));
      const out = new Uint8Array(end - start);
      const pace = new Work();
      for (let pos = start; pos < end; ) {
        const index = find(pos);
        if (index < 0) {
          const next = chunks[-index - 1];
          pos = Math.min(end, next ? next.start : end);
          continue;
        }
        const chunk = /** @type {Chunk} */ (chunks[index]);
        const take = Math.min(end, chunk.end) - pos;
        if (chunk.type === RAW) {
          const bytes = await image.read(chunk.at + (pos - chunk.start), take);
          if (bytes.length < take)
            throw damaged("The disk image is cut short: its data goes past the end of the file.");
          out.set(bytes, pos - start);
        } else if (METHODS[chunk.type]) {
          const bytes = await decoded(index);
          out.set(bytes.subarray(pos - chunk.start, pos - chunk.start + take), pos - start);
          await pace.tick();
        }
        pos += take;
      }
      return out;
    },
  };
}
