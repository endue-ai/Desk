// RAR 5's filters, after libarchive's BSD-licensed RAR 5 reader: delta (bytes split into channels
// and differenced), E8 and E8E9 (x86 call and jump targets made relative again) and ARM (BL
// targets). They run on a block of the window once it is decoded and change only the output.
import { unwrap } from "../ring.js";

export const DELTA = 0;
export const E8 = 1;
export const E8E9 = 2;
export const ARM = 3;

/**
 * @typedef {{ start: number, length: number, type: number, channels: number, offset: number }} Filter
 * `start` is a stream position; `offset` the same position counted from the file's start.
 */

/** @param {Uint8Array} b @param {number} i */
const read32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
/** @param {Uint8Array} b @param {number} i @param {number} v */
function write32(b, i, v) {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
  b[i + 2] = (v >>> 16) & 0xff;
  b[i + 3] = (v >>> 24) & 0xff;
}

/** Runs `filter` on its block of the ring `win`: the filtered bytes. @param {Filter} filter @param {Uint8Array} win */
export function run(filter, win) {
  const src = unwrap(win, filter.start, filter.length);
  const length = filter.length;
  if (filter.type === DELTA) {
    const out = new Uint8Array(length);
    const channels = filter.channels;
    let k = 0;
    for (let c = 0; c < channels; c++) {
      let prev = 0;
      for (let d = c; d < length; d += channels) {
        prev = (prev - /** @type {number} */ (src[k++])) & 0xff;
        out[d] = prev;
      }
    }
    return out;
  }
  const out = src.slice();
  if (filter.type === ARM) {
    for (let i = 0; i + 3 < length; i += 4) {
      if (src[i + 3] !== 0xeb) continue;
      const target = (read32(src, i) & 0xffffff) - Math.floor((i + filter.offset) / 4);
      write32(out, i, ((target & 0xffffff) | 0xeb000000) >>> 0);
    }
    return out;
  }
  const jumps = filter.type === E8E9;
  const FILE = 0x1000000;
  for (let i = 0; i < length - 4; ) {
    const b = src[i++];
    if (b !== 0xe8 && !(jumps && b === 0xe9)) continue;
    const offset = (i + filter.offset) % FILE;
    const address = read32(src, i);
    if (address & 0x80000000) {
      if (((address + offset) & 0x80000000) === 0) write32(out, i, (address + FILE) >>> 0);
    } else if ((address - FILE) & 0x80000000) write32(out, i, (address - offset) >>> 0);
    i += 4;
  }
  return out;
}
