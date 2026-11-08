// Writing ISO base media boxes (ISO/IEC 14496-12): a growable byte writer and box helpers. The muxer
// (fmp4.js) and the codec configurations (config.js) build their boxes with it.

/** Bytes written in order, big-endian. */
export class Writer {
  constructor(size = 256) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.length = 0;
  }
  /** @param {number} n */
  #room(n) {
    if (this.length + n <= this.bytes.length) return;
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n));
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }
  /** @param {number} value */
  u8(value) {
    this.#room(1);
    this.bytes[this.length++] = value & 0xff;
    return this;
  }
  /** @param {number} value */
  u16(value) {
    this.#room(2);
    this.view.setUint16(this.length, value & 0xffff);
    this.length += 2;
    return this;
  }
  /** @param {number} value */
  u24(value) {
    return this.u8(value >>> 16).u16(value & 0xffff);
  }
  /** @param {number} value */
  u32(value) {
    this.#room(4);
    this.view.setUint32(this.length, value >>> 0);
    this.length += 4;
    return this;
  }
  /** @param {number} value */
  i32(value) {
    this.#room(4);
    this.view.setInt32(this.length, value | 0);
    this.length += 4;
    return this;
  }
  /** @param {number} value up to 2^53 */
  u64(value) {
    return this.u32(Math.floor(value / 2 ** 32)).u32(value % 2 ** 32);
  }
  /** @param {Uint8Array} bytes */
  put(bytes) {
    this.#room(bytes.length);
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
    return this;
  }
  /** ASCII text, as a box type or a fixed field. @param {string} text */
  text(text) {
    for (let i = 0; i < text.length; i++) this.u8(text.charCodeAt(i));
    return this;
  }
  /** @param {number} n */
  zeros(n) {
    this.#room(n);
    this.bytes.fill(0, this.length, this.length + n);
    this.length += n;
    return this;
  }
  done() {
    return this.bytes.slice(0, this.length);
  }
}

/** @typedef {Uint8Array | ((w: Writer) => unknown)} Part */

/**
 * A box: its size, its four-character type, then each part (bytes, or a function that writes).
 * @param {string} type
 * @param {...Part} parts
 */
export function box(type, ...parts) {
  const w = new Writer();
  w.u32(0).text(type);
  for (const part of parts) {
    if (part instanceof Uint8Array) w.put(part);
    else part(w);
  }
  const out = w.done();
  new DataView(out.buffer).setUint32(0, out.length);
  return out;
}

/**
 * A full box: a box whose content starts with a version and 24 bits of flags.
 * @param {string} type
 * @param {number} version
 * @param {number} flags
 * @param {...Part} parts
 */
export const fullBox = (type, version, flags, ...parts) =>
  box(type, (w) => w.u8(version).u24(flags), ...parts);

/** Bytes one after another. @param {Uint8Array[]} parts */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
