// Binary property lists (`bplist00`, as `plutil -convert binary1` writes them) into the typed tree:
// dict, array, set, string (ASCII, UTF-16 and UTF-8), integer, real, boolean, date, data and UID.
// Each node knows its byte offset, which the hex dump shows as a row and a column. A damaged file
// is an error, never a throw; shared and cyclic references are bounded.

import { bytesPosition, dateText, readUint } from "./binary.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 */

const MAX_NODES = 1_000_000;
const MAX_DEPTH = 512;
/** Seconds from 1970 to 2001, the epoch of plist dates. */
const APPLE_EPOCH = 978_307_200;

class Damaged extends Error {}

/** @param {Uint8Array} bytes @returns {DataDoc} */
export function parseBplist(bytes) {
  try {
    return { roots: [new Bplist(bytes).root()], errors: [], warnings: [] };
  } catch (error) {
    if (!(error instanceof Damaged) && !(error instanceof RangeError)) throw error;
    const message =
      error instanceof RangeError ? "The binary property list ends early." : error.message;
    return { roots: [], errors: [{ message, line: 1, col: 1 }], warnings: [] };
  }
}

class Bplist {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 40)
      throw new Damaged(`The binary property list ends early (${bytes.length} bytes).`);
    const trailer = bytes.length - 32;
    this.offsetSize = bytes[trailer + 6] ?? 0;
    this.refSize = bytes[trailer + 7] ?? 0;
    this.count = Number(readUint(bytes, trailer + 8, 8));
    this.top = Number(readUint(bytes, trailer + 16, 8));
    this.table = Number(readUint(bytes, trailer + 24, 8));
    const tableEnd = this.table + this.count * this.offsetSize;
    if (this.offsetSize < 1 || this.offsetSize > 8 || this.refSize < 1 || this.refSize > 8)
      throw new Damaged("The binary property list is damaged: its trailer is not valid.");
    if (this.table < 8 || tableEnd > trailer || !Number.isSafeInteger(tableEnd))
      throw new Damaged("The binary property list is damaged: its offset table is out of range.");
    if (this.top >= this.count)
      throw new Damaged("The binary property list is damaged: its top object is missing.");
    this.made = 0;
    /** @type {Set<number>} */
    this.path = new Set();
  }

  root() {
    return this.object(this.top, 0);
  }

  /** @param {number} ref */
  offsetOf(ref) {
    if (ref >= this.count)
      throw new Damaged(`The binary property list is damaged: object ${ref} is out of range.`);
    const offset = Number(
      readUint(this.bytes, this.table + ref * this.offsetSize, this.offsetSize),
    );
    if (offset < 8 || offset >= this.table)
      throw new Damaged(`The binary property list is damaged: object ${ref} has a bad offset.`);
    return offset;
  }

  /** A count from the marker's low nibble, or from the int that follows when it is 0xF. */
  length(/** @type {number} */ at, /** @type {number} */ info) {
    if (info !== 0x0f) return { length: info, start: at + 1 };
    const marker = this.bytes[at + 1] ?? 0;
    if (marker >> 4 !== 0x1)
      throw new Damaged(`The binary property list is damaged at byte ${at}.`);
    const size = 1 << (marker & 0x0f);
    return { length: Number(readUint(this.bytes, at + 2, size)), start: at + 2 + size };
  }

  /**
   * @param {number} ref
   * @param {number} depth
   * @returns {DataNode}
   */
  object(ref, depth) {
    if (++this.made > MAX_NODES || depth > MAX_DEPTH)
      throw new Damaged("The binary property list is too deep or too large to show.");
    const at = this.offsetOf(ref);
    const { bytes, view } = this;
    const marker = bytes[at] ?? 0;
    const type = marker >> 4;
    const info = marker & 0x0f;
    const base = { ...bytesPosition(at), offset: at };
    /** @param {number} from @param {number} to */
    const span = (from, to) => {
      if (to > this.table) throw new Damaged(`The binary property list is damaged at byte ${at}.`);
      return { from, to };
    };
    if (marker === 0x00) return { kind: "null", value: null, ...base, ...span(at, at + 1) };
    if (marker === 0x08 || marker === 0x09)
      return { kind: "boolean", value: marker === 0x09, ...base, ...span(at, at + 1) };
    if (type === 0x1) {
      const size = 1 << info;
      const value =
        size === 8
          ? view.getBigInt64(at + 1)
          : size === 16
            ? signed128(bytes, at + 1)
            : readUint(bytes, at + 1, size);
      return { kind: "number", value: String(value), ...base, ...span(at + 1, at + 1 + size) };
    }
    if (type === 0x2) {
      const value = info === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      return {
        kind: "number",
        value: String(value),
        ...base,
        ...span(at + 1, at + 1 + (1 << info)),
      };
    }
    if (marker === 0x33) {
      const value = dateText((view.getFloat64(at + 1) + APPLE_EPOCH) * 1000);
      return { kind: "date", value, ...base, ...span(at + 1, at + 9) };
    }
    if (type === 0x8)
      return {
        kind: "number",
        value: String(readUint(bytes, at + 1, info + 1)),
        tag: "UID",
        ...base,
        ...span(at + 1, at + 2 + info),
      };
    const { length, start } = this.length(at, info);
    if (type === 0x4)
      return {
        kind: "binary",
        value: bytes.slice(start, start + length),
        ...base,
        ...span(start, start + length),
      };
    if (type === 0x5 || type === 0x7) {
      const value = new TextDecoder(type === 0x5 ? "latin1" : "utf-8").decode(
        bytes.subarray(start, start + length),
      );
      return { kind: "string", value, ...base, ...span(start, start + length) };
    }
    if (type === 0x6) {
      const units = [];
      for (let i = 0; i < length; i++) units.push(view.getUint16(start + i * 2));
      return {
        kind: "string",
        value: String.fromCharCode(...units),
        ...base,
        ...span(start, start + length * 2),
      };
    }
    if (type === 0xa || type === 0xb || type === 0xc || type === 0xd)
      return this.collection(ref, type, length, start, base, depth);
    throw new Damaged(
      `The binary property list holds an object it does not know (0x${marker.toString(16)}) at byte ${at}.`,
    );
  }

  /**
   * @param {number} ref
   * @param {number} type
   * @param {number} length
   * @param {number} start
   * @param {{ line: number, col: number, offset: number }} base
   * @param {number} depth
   * @returns {DataNode}
   */
  collection(ref, type, length, start, base, depth) {
    if (this.path.has(ref))
      throw new Damaged("The binary property list refers to itself in a loop.");
    this.path.add(ref);
    const refAt = (/** @type {number} */ i) =>
      Number(readUint(this.bytes, start + i * this.refSize, this.refSize));
    /** @type {DataNode[]} */
    const children = [];
    if (type === 0xd) {
      for (let i = 0; i < length; i++) {
        const key = this.object(refAt(i), depth + 1);
        const value = this.object(refAt(length + i), depth + 1);
        children.push(Object.assign(value, { key: String(key.value) }));
      }
    } else {
      for (let i = 0; i < length; i++)
        children.push(Object.assign(this.object(refAt(i), depth + 1), { key: i }));
    }
    this.path.delete(ref);
    const end = start + (type === 0xd ? 2 : 1) * length * this.refSize;
    /** @type {DataNode} */
    const node = {
      kind: type === 0xd ? "object" : "array",
      children,
      ...base,
      from: base.offset,
      to: end,
    };
    if (type === 0xc || type === 0xb) node.tag = type === 0xc ? "set" : "ordered set";
    return node;
  }
}

/** A signed 128-bit big-endian integer. */
function signed128(/** @type {Uint8Array} */ bytes, /** @type {number} */ at) {
  const value = readUint(bytes, at, 16);
  return (bytes[at] ?? 0) & 0x80 ? value - (1n << 128n) : value;
}
