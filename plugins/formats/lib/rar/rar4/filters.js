// RAR 3's filters, after libarchive's BSD-licensed RAR reader. RAR 3 sends filters as programs for
// its virtual machine; the standard ones (E8, E8E9, delta, RGB, audio) are recognised by their
// code's CRC and length and run natively. Any other program is refused. They change only the output.
import { crc32 } from "../crc32.js";
import { DAMAGED } from "../entries.js";

export const OTHER_VM =
  "It uses a RAR virtual machine filter other than the standard ones, which is not supported: not extracted.";

/** Standard programs by CRC and length. */
const KNOWN = new Map([
  [0x0e06077d * 0x100 + 29, "delta"],
  [0xad576887 * 0x100 + 53, "e8"],
  [0x3cd7e57e * 0x100 + 57, "e8e9"],
  [0x1c2c5dc8 * 0x100 + 149, "rgb"],
  [0xbc85e701 * 0x100 + 216, "audio"],
]);
const WORK = 0x3c000;
const MOST_FILTERS = 8192;

/** @typedef {{ kind: string | undefined, oldLength: number, usage: number }} Program */
/** @typedef {{ start: number, length: number, program: Program, registers: number[] }} Filter */

/** A bit reader over a filter's bytes, most significant bit first. */
class Bits {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  /** @param {number} n up to 32 */
  bits(n) {
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) {
      const byte = this.bytes[this.pos >>> 3];
      if (byte === undefined) throw new Error(DAMAGED);
      v = v * 2 + ((byte >>> (7 - (this.pos & 7))) & 1);
    }
    return v;
  }
  /** RAR VM's numbers: two bits saying how many follow. */
  number() {
    switch (this.bits(2)) {
      case 0:
        return this.bits(4);
      case 1: {
        const v = this.bits(8);
        return v >= 16 ? v : (0xffffff00 | (v << 4) | this.bits(4)) >>> 0;
      }
      case 2:
        return this.bits(16);
      default:
        return this.bits(32);
    }
  }
}

export class Filters4 {
  constructor() {
    /** @type {Program[]} */
    this.programs = [];
    /** @type {Filter[]} */
    this.stack = [];
    this.last = 0;
  }

  /**
   * A filter definition read from the stream at stream position `pos`.
   * @param {Uint8Array} code @param {number} flags @param {number} pos @param {number} most the longest block allowed
   */
  define(code, flags, pos, most) {
    const br = new Bits(code);
    let num = this.last;
    if (flags & 0x80) {
      num = br.number();
      if (num === 0) {
        this.stack = [];
        this.programs = [];
      } else num--;
      if (num > this.programs.length) throw new Error(DAMAGED);
      this.last = num;
    }
    let program = this.programs[num];
    if (program) program.usage++;
    let start = br.number() + pos;
    if (flags & 0x40) start += 258;
    const length = flags & 0x20 ? br.number() : (program?.oldLength ?? 0);
    if (length > most || length > WORK) throw new Error(DAMAGED);
    const registers = [0, 0, 0, WORK, length, program?.usage ?? 0, 0, 0x40000];
    if (flags & 0x10) {
      const mask = br.bits(7);
      for (let i = 0; i < 7; i++) if (mask & (1 << i)) registers[i] = br.number();
    }
    if (!program) {
      const size = br.number();
      if (size === 0 || size > 0x10000) throw new Error(DAMAGED);
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = br.bits(8);
      let xor = 0;
      for (let i = 1; i < size; i++) xor ^= /** @type {number} */ (bytes[i]);
      if (xor !== bytes[0]) throw new Error(DAMAGED);
      program = { kind: KNOWN.get(crc32(bytes) * 0x100 + size), oldLength: 0, usage: 0 };
      this.programs.push(program);
    }
    program.oldLength = length;
    if (flags & 0x08) {
      const global = br.number();
      if (global > 0x2000 - 0x40) throw new Error(DAMAGED);
      br.pos += global * 8;
      if (br.pos > code.length * 8) throw new Error(DAMAGED);
    }
    if (this.stack.length >= MOST_FILTERS) throw new Error(DAMAGED);
    this.stack.push({ start, length, program, registers });
  }
}

/**
 * Runs a standard filter on `src` (its block); `at` is the block's position in the file.
 * @param {Filter} filter @param {Uint8Array} src @param {number} at @returns {Uint8Array}
 */
export function execute(filter, src, at) {
  const length = src.length;
  const r = filter.registers;
  switch (filter.program.kind) {
    case "e8":
    case "e8e9":
      return e8(src, at, filter.program.kind === "e8e9");
    case "delta":
      return delta(src, /** @type {number} */ (r[0]));
    case "rgb":
      return rgb(src, /** @type {number} */ (r[0]), /** @type {number} */ (r[1]));
    case "audio":
      return audio(src, /** @type {number} */ (r[0]));
    default:
      if (length < 0) throw new Error(DAMAGED);
      throw new Error(OTHER_VM);
  }
}

/** @param {Uint8Array} src @param {number} at @param {boolean} jumps */
function e8(src, at, jumps) {
  const out = src.slice();
  const FILE = 0x1000000;
  /** @param {number} i @param {number} v */
  const put = (i, v) => {
    out[i] = v & 0xff;
    out[i + 1] = (v >>> 8) & 0xff;
    out[i + 2] = (v >>> 16) & 0xff;
    out[i + 3] = (v >>> 24) & 0xff;
  };
  for (let i = 0; i + 5 <= out.length; i++) {
    const b = out[i];
    if (b !== 0xe8 && !(jumps && b === 0xe9)) continue;
    const here = (at + i + 1) % 0x100000000;
    const address = out[i + 1] | (out[i + 2] << 8) | (out[i + 3] << 16) | (out[i + 4] << 24);
    if (address < 0) {
      if (here >= -address) put(i + 1, address + FILE);
    } else if (address < FILE) put(i + 1, address - here);
    i += 4;
  }
  return out;
}

/** @param {Uint8Array} src @param {number} channels */
function delta(src, channels) {
  const length = src.length;
  if (channels === 0 || channels > 128 || length > WORK / 2) throw new Error(DAMAGED);
  const out = new Uint8Array(length);
  let k = 0;
  for (let c = 0; c < channels; c++) {
    let last = 0;
    for (let i = c; i < length; i += channels) {
      last = (last - /** @type {number} */ (src[k++])) & 0xff;
      out[i] = last;
    }
  }
  return out;
}

/** RGB: three colour planes predicted from the pixel to the left and the row above. @param {Uint8Array} src @param {number} stride @param {number} offset */
function rgb(src, stride, offset) {
  const length = src.length;
  if (length > WORK / 2 || stride > length || length < 3 || offset > 2) throw new Error(DAMAGED);
  const out = new Uint8Array(length);
  let k = 0;
  for (let c = 0; c < 3; c++) {
    let byte = 0;
    for (let j = c; j < length; j += 3) {
      const prev = j - stride;
      if (prev >= 0) {
        const above = /** @type {number} */ (out[prev]);
        const aboveRight = /** @type {number} */ (out[prev + 3]);
        const d1 = Math.abs(aboveRight - above);
        const d2 = Math.abs(byte - above);
        const d3 = Math.abs(aboveRight - above + byte - above);
        if (d1 > d2 || d1 > d3) byte = d2 <= d3 ? aboveRight : above;
      }
      byte = (byte - /** @type {number} */ (src[k++])) & 0xff;
      out[j] = byte;
    }
  }
  for (let i = offset; i < length - 2; i += 3) {
    const g = /** @type {number} */ (out[i + 1]);
    out[i] = /** @type {number} */ (out[i] + g) & 0xff;
    out[i + 2] = /** @type {number} */ (out[i + 2] + g) & 0xff;
  }
  return out;
}

/** Audio: each channel predicted from its last bytes with weights that adapt. @param {Uint8Array} src @param {number} channels */
function audio(src, channels) {
  const length = src.length;
  if (channels === 0 || channels > 128 || length > WORK / 2) throw new Error(DAMAGED);
  const out = new Uint8Array(length);
  const error = new Int32Array(7);
  let k = 0;
  for (let c = 0; c < channels; c++) {
    let lastByte = 0;
    let lastDelta = 0;
    let d0 = 0;
    let d1 = 0;
    let d2 = 0;
    let w0 = 0;
    let w1 = 0;
    let w2 = 0;
    let count = 0;
    error.fill(0);
    for (let j = c; j < length; j += channels) {
      const delta = /** @type {number} */ (src[k++] << 24) >> 24;
      d2 = d1;
      d1 = lastDelta - d0;
      d0 = lastDelta;
      const predicted = ((8 * lastByte + w0 * d0 + w1 * d1 + w2 * d2) >> 3) & 0xff;
      const byte = (predicted - delta) & 0xff;
      const e = delta * 8;
      error[0] += Math.abs(e);
      error[1] += Math.abs(e - d0);
      error[2] += Math.abs(e + d0);
      error[3] += Math.abs(e - d1);
      error[4] += Math.abs(e + d1);
      error[5] += Math.abs(e - d2);
      error[6] += Math.abs(e + d2);
      lastDelta = ((byte - lastByte) << 24) >> 24;
      lastByte = byte;
      out[j] = byte;
      if (!(count++ & 0x1f)) {
        let best = 0;
        for (let i = 1; i < 7; i++)
          if (/** @type {number} */ (error[i]) < /** @type {number} */ (error[best])) best = i;
        error.fill(0);
        if (best === 1 && w0 >= -16) w0--;
        else if (best === 2 && w0 < 16) w0++;
        else if (best === 3 && w1 >= -16) w1--;
        else if (best === 4 && w1 < 16) w1++;
        else if (best === 5 && w2 >= -16) w2--;
        else if (best === 6 && w2 < 16) w2++;
      }
    }
  }
  return out;
}
