// A cursor over bytes for the binary formats (MessagePack, CBOR, BSON): big- and little-endian
// integers, floats, UTF-8 text and C strings. Reading past the end is a RangeError, which the
// parsers report as "ends early" with the byte it happened at.

import { bytesPosition } from "./binary.js";

/** @typedef {import("../tree.js").DataNode} DataNode */

const MAX_DEPTH = 512;
const utf8 = new TextDecoder("utf-8");

export class BinaryFail extends Error {
  /** @param {number} offset @param {string} message */
  constructor(offset, message) {
    super(message);
    this.offset = offset;
  }
}

export class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  /** @param {number} size */
  need(size) {
    if (this.pos + size > this.bytes.length) throw new RangeError("past the end");
    const at = this.pos;
    this.pos += size;
    return at;
  }

  u8() {
    return this.view.getUint8(this.need(1));
  }

  i8() {
    return this.view.getInt8(this.need(1));
  }

  /** An unsigned big-endian integer of 1, 2, 4 or 8 bytes, as a number (a length or count). */
  uint(/** @type {number} */ size) {
    const value = this.big(size, false);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BinaryFail(this.pos - size, "A length is too large.");
    return Number(value);
  }

  /** An integer of 1, 2, 4 or 8 bytes, big-endian, as a BigInt. */
  big(/** @type {number} */ size, /** @type {boolean} */ signed, little = false) {
    const at = this.need(size);
    const v = this.view;
    if (size === 1) return BigInt(signed ? v.getInt8(at) : v.getUint8(at));
    if (size === 2) return BigInt(signed ? v.getInt16(at, little) : v.getUint16(at, little));
    if (size === 4) return BigInt(signed ? v.getInt32(at, little) : v.getUint32(at, little));
    return signed ? v.getBigInt64(at, little) : v.getBigUint64(at, little);
  }

  f32(little = false) {
    return this.view.getFloat32(this.need(4), little);
  }

  f64(little = false) {
    return this.view.getFloat64(this.need(8), little);
  }

  /** @param {number} size */
  take(size) {
    const at = this.need(size);
    return this.bytes.slice(at, at + size);
  }

  /** @param {number} size */
  text(size) {
    const at = this.need(size);
    return utf8.decode(this.bytes.subarray(at, at + size));
  }

  /** A NUL-terminated string. */
  cstring() {
    const end = this.bytes.indexOf(0, this.pos);
    if (end < 0) throw new RangeError("past the end");
    const value = utf8.decode(this.bytes.subarray(this.pos, end));
    this.pos = end + 1;
    return value;
  }

  /** @param {number} depth */
  deep(depth) {
    if (depth > MAX_DEPTH) throw new BinaryFail(this.pos, "The data is nested too deeply to show.");
  }

  /** @param {number} at @param {string} what */
  bad(at, what) {
    return new BinaryFail(at, `The data is damaged at byte ${at}: ${what}.`);
  }

  /**
   * The parse error for a failure while decoding `name` data.
   * @param {unknown} error
   * @param {string} name
   */
  failure(error, name) {
    if (error instanceof BinaryFail)
      return { message: error.message, ...bytesPosition(error.offset) };
    if (error instanceof RangeError)
      return {
        message: `The ${name} data ends early at byte ${this.pos}.`,
        ...bytesPosition(this.pos),
      };
    throw error;
  }
}

/** The text a map key shows as. */
export function keyOf(/** @type {DataNode | undefined} */ node) {
  if (!node) return "";
  if (node.value instanceof Uint8Array) return `${node.value.length} bytes`;
  if (node.kind === "object" || node.kind === "array") return node.kind === "array" ? "[…]" : "{…}";
  return String(node.value);
}
