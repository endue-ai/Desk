// OfficeArt property tables ([MS-ODRAW] 2.2.9 OfficeArtFOPT, 2.2.10 OfficeArtTertiaryFOPT): values by
// property id, the data of complex properties, IMsoArray elements, booleans with their "use" bits
// and fixed-point numbers. No DOM.
import { i16, i32, u16, u32 } from "./records.js";

/**
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {{ value: number, data: Uint8Array | null }} Option  data: a complex property's bytes.
 * @typedef {Map<number, Option>} Options
 */

/** Properties whose complex data is an IMsoArray, whose size may leave out its 6-byte header. */
const ARRAYS = new Set([
  0x0145, 0x0146, 0x0151, 0x0152, 0x0155, 0x0156, 0x0157, 0x0197, 0x01cf, 0x0383, 0x03a0,
]);

/**
 * The properties of FOPT records, the first record winning where two name one property.
 * @param {Uint8Array} b @param {Array<PptRecord | null | undefined>} records
 * @returns {Options}
 */
export function optionsOf(b, records) {
  /** @type {Options} */
  const out = new Map();
  for (const rec of records) {
    if (!rec) continue;
    const end = rec.body + rec.len;
    let data = rec.body + rec.inst * 6;
    for (let i = 0; i < rec.inst && rec.body + i * 6 + 6 <= end; i++) {
      const at = rec.body + i * 6;
      const opid = u16(b, at);
      const pid = opid & 0x3fff;
      const value = u32(b, at + 2);
      /** @type {Uint8Array | null} */
      let bytes = null;
      if (opid & 0x8000) {
        let size = value;
        if (ARRAYS.has(pid) && data + 6 <= end) {
          const count = u16(b, data);
          const each = elementSize(u16(b, data + 4));
          if (count * each === value) size = value + 6;
        }
        bytes = b.subarray(data, Math.min(end, data + size));
        data += size;
      }
      if (!out.has(pid)) out.set(pid, { value, data: bytes });
    }
  }
  return out;
}

/** An IMsoArray's element size: 0xFFF0 stands for 4. @param {number} cb */
const elementSize = (cb) => (cb === 0xfff0 ? 4 : cb);

/** A property's value, or the fallback. @param {Options} opts @param {number} pid @param {number} [fallback] */
export const value = (opts, pid, fallback = 0) => opts.get(pid)?.value ?? fallback;

/** A property as a signed 32-bit integer. @param {Options} opts @param {number} pid */
export const signed = (opts, pid, fallback = 0) => {
  const v = opts.get(pid)?.value;
  return v === undefined ? fallback : v | 0;
};

/** A FixedPoint (16.16) property. @param {Options} opts @param {number} pid @param {number} [fallback] */
export const fixed = (opts, pid, fallback = 0) => {
  const v = opts.get(pid)?.value;
  return v === undefined ? fallback : (v | 0) / 65536;
};

/**
 * One boolean of a boolean property set: bit `bit` holds the value, bit `bit + 16` says whether it
 * is set at all. Undefined when it is not. A set without any of those bits (older writers) counts
 * the bits that are on.
 * @param {Options} opts @param {number} pid @param {number} bit @returns {boolean | undefined}
 */
export function flag(opts, pid, bit) {
  const v = opts.get(pid)?.value;
  if (v === undefined) return undefined;
  if (!(v & 0xffff0000)) return v & (1 << bit) ? true : undefined;
  if (!(v & (1 << (bit + 16)))) return undefined;
  return Boolean(v & (1 << bit));
}

/** Boolean property sets are each group's last property: 0x007F, 0x00BF, 0x00FF, ... */
const isBooleans = (/** @type {number} */ pid) => (pid & 0x3f) === 0x3f;

/**
 * A shape's properties over the ones it inherits (its master shape's): its own win, and for boolean
 * sets each boolean it sets.
 * @param {Options} own @param {Options | undefined} base @returns {Options}
 */
export function inherit(own, base) {
  if (!base) return own;
  const out = new Map(base);
  for (const [pid, option] of own) {
    const under = base.get(pid);
    if (!isBooleans(pid) || !under || !(option.value & 0xffff0000)) {
      out.set(pid, option);
      continue;
    }
    let merged = 0;
    for (let bit = 0; bit < 16; bit++) {
      const use = 1 << (bit + 16);
      const from = option.value & use ? option.value : under.value & use ? under.value : 0;
      if (from) merged |= (from & (1 << bit)) | use;
    }
    out.set(pid, { value: merged >>> 0, data: null });
  }
  return out;
}

/**
 * The elements of an IMsoArray property, each as its bytes' offset into `data`.
 * @param {Options} opts @param {number} pid
 * @returns {{ data: Uint8Array, size: number, offsets: number[] } | null}
 */
export function arrayOf(opts, pid) {
  const data = opts.get(pid)?.data;
  if (!data || data.length < 6) return null;
  const count = u16(data, 0);
  const size = elementSize(u16(data, 4));
  if (size === 0) return null;
  const offsets = [];
  for (let i = 0; i < count && 6 + (i + 1) * size <= data.length; i++) offsets.push(6 + i * size);
  return { data, size, offsets };
}

/**
 * The points of an array of POINTs (4-byte elements: two int16; 8-byte: two int32).
 * @param {Options} opts @param {number} pid @returns {Array<[number, number]>}
 */
export function pointsOf(opts, pid) {
  const array = arrayOf(opts, pid);
  if (!array) return [];
  const { data, size, offsets } = array;
  return offsets.map((at) =>
    size >= 8 ? [i32(data, at), i32(data, at + 4)] : [i16(data, at), i16(data, at + 2)],
  );
}

/** The 16-bit elements of an array property. @param {Options} opts @param {number} pid */
export function wordsOf(opts, pid) {
  const array = arrayOf(opts, pid);
  return array ? array.offsets.map((at) => u16(array.data, at)) : [];
}

/** A complex property holding a UTF-16 string, without its terminator. @param {Options} opts @param {number} pid */
export function stringOf(opts, pid) {
  const data = opts.get(pid)?.data;
  if (!data) return "";
  let s = "";
  for (let at = 0; at + 1 < data.length; at += 2) {
    const c = u16(data, at);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}
