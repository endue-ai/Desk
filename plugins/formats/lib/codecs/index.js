// The decoders by name. Each is an async generator over an Input that yields decoded chunks;
// decodeStream gives the event loop a turn now and then, so a long decode never freezes the surface.
import { bunzip2 } from "./bzip2/index.js";
import { gunzip, inflateRaw, inflateZlib } from "./inflate.js";
import { Input, inputFrom, inputOf, inputOfChunks, named } from "./input.js";
import { unlz4 } from "./lz4.js";
import { unlzma, unxz } from "./lzma/index.js";
import { uncompress } from "./lzw.js";
import { unzstd } from "./zstd/index.js";

/** @typedef {import("./input.js").Source} Source */
/** @typedef {(input: Input, options?: any) => AsyncGenerator<Uint8Array>} Decoder */

/** @type {Record<string, Decoder>} */
const DECODERS = {
  deflate: inflateRaw,
  zlib: inflateZlib,
  gzip: gunzip,
  bzip2: bunzip2,
  xz: unxz,
  lzma: unlzma,
  zstd: unzstd,
  lz4: unlz4,
  lzw: uncompress,
};

/** The codec's name as people know it, for formats and errors. */
export const CODEC_NAMES = /** @type {Record<string, string>} */ ({
  deflate: "Deflate",
  zlib: "zlib",
  gzip: "gzip",
  bzip2: "bzip2",
  xz: "xz",
  lzma: "LZMA",
  zstd: "Zstandard",
  lz4: "LZ4",
  lzw: "compress",
});

/** One turn of the event loop. */
export const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The decoded chunks of `input`, with a pause every 25 ms of work.
 * @param {string} codec @param {Input} input @param {any} [options]
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* decodeStream(codec, input, options) {
  const decoder = DECODERS[codec];
  if (!decoder) throw new Error(`No decoder for ${codec}.`);
  let last = Date.now();
  try {
    for await (const chunk of decoder(input, options)) {
      yield chunk;
      if (Date.now() - last > 25) {
        await pause();
        last = Date.now();
      }
    }
  } catch (error) {
    throw named(CODEC_NAMES[codec] ?? codec, error);
  }
}

/**
 * A decoded part of a source, as an Input a reader can pull from.
 * @param {string} codec @param {Source} source @param {any} [options]
 */
export const decodedInput = (codec, source, options = undefined) =>
  inputOfChunks(decodeStream(codec, inputFrom(source), options));

/**
 * The first `limit` bytes of a stream of chunks, then the stream is let go.
 * @param {AsyncIterable<Uint8Array>} chunks @param {number} [limit] @param {number} [expect] a size hint
 */
export async function collect(chunks, limit = Number.POSITIVE_INFINITY, expect = 0) {
  /** @type {Uint8Array[]} */
  const parts = [];
  let total = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    total += chunk.length;
    if (total >= limit) break;
  }
  const size = Math.min(total, limit);
  const out = new Uint8Array(Math.max(size, 0));
  let at = 0;
  for (const part of parts) {
    if (at >= size) break;
    const take = part.subarray(0, size - at);
    out.set(take, at);
    at += take.length;
  }
  void expect;
  return out;
}

/**
 * Decode all of `bytes` (or its first `limit` bytes).
 * @param {string} codec @param {Uint8Array} bytes @param {any} [options] @param {number} [limit]
 */
export const decode = (codec, bytes, options = undefined, limit = Number.POSITIVE_INFINITY) =>
  collect(decodeStream(codec, inputOf(bytes), options), limit);

export { Input, inputFrom, inputOf, inputOfChunks };
