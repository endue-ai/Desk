// The compressors a SquashFS 4.0 image names in its superblock, each block one whole stream: zlib
// (named gzip), xz, LZ4 (a bare block), Zstandard frames through lib/codecs, and LZO1X here. The
// compressor options block after the superblock is read for the details.
import { decode } from "../codecs/index.js";
import { u16, u32 } from "../disk/bytes.js";
import { lzo1x } from "./lzo.js";

/** The compression ids of the superblock. */
export const COMPRESSORS = /** @type {Record<number, string>} */ ({
  1: "gzip",
  2: "LZMA",
  3: "LZO",
  4: "xz",
  5: "LZ4",
  6: "zstd",
});

export const LEGACY_LZMA =
  "SquashFS images compressed with the legacy LZMA format are not read; images made with xz are.";

/** @typedef {(bytes: Uint8Array, max: number) => Promise<Uint8Array>} BlockDecoder */

/** An LZ4 block as the legacy LZ4 format's one block: its magic, its size, the block. @param {Uint8Array} block */
function legacyFrame(block) {
  const out = new Uint8Array(block.length + 8);
  out.set([0x02, 0x21, 0x4c, 0x18], 0);
  new DataView(out.buffer).setUint32(4, block.length, true);
  out.set(block, 8);
  return out;
}

/**
 * The decoder for a compression id: it turns one stored block into at most `max` bytes.
 * @param {number} id @returns {BlockDecoder | undefined}
 */
export function blockDecoder(id) {
  switch (id) {
    case 1:
      return (bytes, max) => decode("zlib", bytes, undefined, max);
    case 3:
      return async (bytes, max) => lzo1x(bytes, max);
    case 4:
      return (bytes, max) => decode("xz", bytes, undefined, max);
    case 5:
      return (bytes, max) => decode("lz4", legacyFrame(bytes), undefined, max);
    case 6:
      return (bytes, max) => decode("zstd", bytes, undefined, max);
    default:
      return undefined;
  }
}

const XZ_FILTERS = ["x86", "PowerPC", "IA-64", "ARM", "ARM Thumb", "SPARC", "ARM64", "RISC-V"];
const LZO_ALGORITHMS = ["lzo1x_1", "lzo1x_1_11", "lzo1x_1_12", "lzo1x_1_15", "lzo1x_999"];

/**
 * What the compressor options say, as people read them ("level 9", "BCJ x86"); "" when nothing.
 * @param {number} id @param {Uint8Array} o the options block's decoded bytes
 */
export function describeOptions(id, o) {
  const parts = [];
  if (id === 1 && o.length >= 8) {
    parts.push(`level ${u32(o, 0)}`);
    if (u16(o, 4) !== 15) parts.push(`window ${u16(o, 4)} bits`);
  } else if (id === 4 && o.length >= 8) {
    parts.push(
      `dictionary ${u32(o, 0) >= 1 << 20 ? `${u32(o, 0) >> 20} MiB` : `${u32(o, 0) >> 10} KiB`}`,
    );
    const filters = XZ_FILTERS.filter((_, i) => u32(o, 4) & (1 << i));
    if (filters.length) parts.push(`BCJ ${filters.join(", ")}`);
  } else if (id === 5 && o.length >= 8) {
    if (u32(o, 4) & 1) parts.push("high compression");
  } else if (id === 6 && o.length >= 4) {
    parts.push(`level ${u32(o, 0)}`);
  } else if (id === 3 && o.length >= 8) {
    parts.push(LZO_ALGORITHMS[u32(o, 0)] ?? `algorithm ${u32(o, 0)}`);
    if (u32(o, 0) === 4) parts.push(`level ${u32(o, 4)}`);
  }
  return parts.join(", ");
}
