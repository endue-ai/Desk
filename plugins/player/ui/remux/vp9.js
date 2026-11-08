// VP9's configuration for MP4 (VP Codec ISO Media File Format Binding): the profile, bit depth,
// chroma subsampling and colour from a key frame's uncompressed header (VP9 bitstream spec 6.2), or
// from Matroska's CodecPrivate features, and a level from the picture size.
import { Writer } from "./boxes.js";
import { Bits } from "./nal.js";

/** Luma picture sizes per level (VP9 spec Annex A), smallest first. */
const LEVELS = [
  [10, 36864],
  [11, 73728],
  [20, 122880],
  [21, 245760],
  [30, 552960],
  [31, 983040],
  [40, 2228224],
  [50, 8912896],
  [60, 35651584],
];

/**
 * What a VP9 key frame's uncompressed header says, or defaults (profile 0, 8 bits, 4:2:0).
 * @param {Uint8Array} frame
 */
export function vp9Header(frame) {
  const out = { profile: 0, depth: 8, subsampling: 1, full: 0, space: 0 };
  const b = new Bits(frame);
  if (b.bits(2) !== 2) return out;
  const low = b.bit();
  const profile = (b.bit() << 1) | low;
  if (profile === 3) b.bit();
  out.profile = profile;
  if (b.bit()) return out; // show_existing_frame
  if (b.bit() !== 0) return out; // not a key frame
  b.bits(2);
  if (b.bits(24) !== 0x498342) return out;
  if (profile >= 2) out.depth = b.bit() ? 12 : 10;
  out.space = b.bits(3);
  if (out.space !== 7) {
    out.full = b.bit();
    if (profile === 1 || profile === 3) {
      const x = b.bit();
      const y = b.bit();
      out.subsampling = x && y ? 1 : x ? 2 : 3;
    }
  } else {
    out.full = 1;
    out.subsampling = 3;
  }
  return out;
}

/** Matroska's VP9 CodecPrivate: ID, length, value features (profile 1, level 2, depth 3, chroma 4). */
function features(/** @type {Uint8Array | undefined} */ data) {
  /** @type {Record<number, number>} */
  const out = {};
  for (let at = 0; data && at + 2 < data.length; ) {
    const id = data[at] ?? 0;
    const length = data[at + 1] ?? 0;
    out[id] = data[at + 2] ?? 0;
    at += 2 + length;
  }
  return out;
}

/**
 * The vpcC content after its version and flags (version 1).
 * @param {{ width?: number, height?: number, config?: Uint8Array }} t
 * @param {ReturnType<typeof vp9Header>} header
 */
export function vpcC(t, header) {
  const f = features(t.config);
  const size = (t.width ?? 0) * (t.height ?? 0);
  const level = f[2] ?? LEVELS.find(([, max]) => size <= (max ?? 0))?.[0] ?? 62;
  const profile = f[1] ?? header.profile;
  const depth = f[3] ?? header.depth;
  const chroma = f[4] ?? header.subsampling;
  // BT.709 when the frame says so (colour space 2), otherwise BT.601 (6) or unspecified (2).
  const [primaries, transfer, matrix] =
    header.space === 2 ? [1, 1, 1] : header.space === 1 ? [6, 6, 6] : [2, 2, 2];
  return new Writer()
    .u8(profile)
    .u8(level)
    .u8((depth << 4) | (chroma << 1) | header.full)
    .u8(primaries)
    .u8(transfer)
    .u8(matrix)
    .u16(0)
    .done();
}
