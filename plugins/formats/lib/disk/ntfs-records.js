// NTFS's MFT records and their attributes, from the public NTFS documentation: a FILE record with
// its update-sequence fixups (one per 512 bytes), the in-use and directory flags, the base record
// an extension record belongs to, and attributes that are resident (the value in the record) or
// non-resident (a run list of clusters, maybe compressed or sparse).
import { at, u16, u32, u64, utf16le } from "./bytes.js";

/**
 * @typedef {{ vcn: number, length: number, lcn: number }} Run clusters `vcn`.. of the stream at
 * cluster `lcn` of the volume, or nowhere (sparse, zeros) when `lcn` is -1.
 * @typedef {{
 *   type: number, name: string, flags: number, resident: boolean, value?: Uint8Array,
 *   startVcn: number, runs: Run[], allocated: number, size: number, initialized: number,
 *   compressedSize?: number, unit: number,
 * }} Attribute `unit` is the compression unit as a power of two in clusters (0: none).
 * @typedef {{ inUse: boolean, isDir: boolean, seq: number, base: number, attributes: Attribute[] }} MftRecord
 * @typedef {{
 *   resident?: Uint8Array, runs: Run[], size: number, initialized: number, allocated: number,
 *   compressedSize?: number, unit: number, compressed: boolean, sparse: boolean, encrypted: boolean,
 * }} Stream one attribute's whole value, its fragments joined.
 */

export const STANDARD_INFORMATION = 0x10;
export const ATTRIBUTE_LIST = 0x20;
export const FILE_NAME = 0x30;
export const VOLUME_NAME = 0x60;
export const VOLUME_INFORMATION = 0x70;
export const DATA = 0x80;
export const REPARSE_POINT = 0xc0;

/** The record number in a file reference (its low 48 bits). @param {Uint8Array} b @param {number} o */
export const recordNumber = (b, o) => u32(b, o) + u16(b, o + 4) * 0x100000000;

/**
 * Put back the bytes the update sequence replaced at the end of every 512 bytes. False when the
 * record was torn (a stride does not end with the sequence number).
 * @param {Uint8Array} record
 */
export function fixup(record) {
  const offset = u16(record, 4);
  const count = u16(record, 6);
  if (count < 2 || offset + count * 2 > record.length || (count - 1) * 512 > record.length)
    return false;
  const usn = u16(record, offset);
  for (let k = 1; k < count; k++) {
    const end = k * 512 - 2;
    if (u16(record, end) !== usn) return false;
    record[end] = record[offset + k * 2] ?? 0;
    record[end + 1] = record[offset + k * 2 + 1] ?? 0;
  }
  return true;
}

/**
 * A run list from `o` to `end`: each run a header byte (length and offset field sizes), its
 * length in clusters, and its start relative to the previous run's (signed; none when sparse).
 * @param {Uint8Array} b @param {number} o @param {number} end @param {number} startVcn @returns {Run[]}
 */
export function decodeRuns(b, o, end, startVcn) {
  /** @type {Run[]} */
  const runs = [];
  let vcn = startVcn;
  let lcn = 0;
  while (o < end) {
    const header = b[o++] ?? 0;
    if (header === 0) break;
    const lengthSize = header & 15;
    const offsetSize = header >> 4;
    if (!lengthSize || lengthSize > 8 || offsetSize > 8 || o + lengthSize + offsetSize > end) break;
    let length = 0;
    for (let i = lengthSize - 1; i >= 0; i--) length = length * 256 + (b[o + i] ?? 0);
    o += lengthSize;
    if (offsetSize) {
      let delta = 0;
      for (let i = offsetSize - 1; i >= 0; i--) delta = delta * 256 + (b[o + i] ?? 0);
      if ((b[o + offsetSize - 1] ?? 0) & 0x80) delta -= 2 ** (8 * offsetSize);
      lcn += delta;
      runs.push({ vcn, length, lcn });
    } else runs.push({ vcn, length, lcn: -1 });
    o += offsetSize;
    vcn += length;
  }
  return runs;
}

/**
 * A FILE record, fixed up in place; undefined when it is not one (unused, torn or blank).
 * @param {Uint8Array} b @param {Set<number>} [keep] the attribute types to keep (all when absent)
 * @returns {MftRecord | undefined}
 */
export function parseRecord(b, keep) {
  if (!at(b, 0, "FILE") || !fixup(b)) return undefined;
  const flags = u16(b, 0x16);
  /** @type {Attribute[]} */
  const attributes = [];
  const used = Math.min(b.length, u32(b, 0x18) || b.length);
  for (let o = u16(b, 0x14); o + 16 <= used; ) {
    const type = u32(b, o);
    const length = u32(b, o + 4);
    if (type === 0xffffffff || length < 16 || o + length > used) break;
    if (!keep || keep.has(type)) attributes.push(attribute(b, o, o + length, type));
    o += length;
  }
  return {
    inUse: !!(flags & 1),
    isDir: !!(flags & 2),
    seq: u16(b, 0x10),
    base: recordNumber(b, 0x20),
    attributes,
  };
}

/** @param {Uint8Array} b @param {number} o @param {number} end @param {number} type @returns {Attribute} */
function attribute(b, o, end, type) {
  const nameLength = b[o + 9] ?? 0;
  const nameAt = o + u16(b, o + 10);
  const name = nameLength
    ? utf16le(b.subarray(nameAt, Math.min(end, nameAt + nameLength * 2)))
    : "";
  const flags = u16(b, o + 12);
  if (!b[o + 8]) {
    const valueAt = o + u16(b, o + 20);
    const value = b.slice(valueAt, Math.min(end, valueAt + u32(b, o + 16)));
    const size = value.length;
    return {
      type,
      name,
      flags,
      resident: true,
      value,
      startVcn: 0,
      runs: [],
      allocated: size,
      size,
      initialized: size,
      unit: 0,
    };
  }
  const runsAt = u16(b, o + 32);
  const startVcn = u64(b, o + 16);
  return {
    type,
    name,
    flags,
    resident: false,
    startVcn,
    runs: decodeRuns(b, o + runsAt, end, startVcn),
    allocated: u64(b, o + 40),
    size: u64(b, o + 48),
    initialized: u64(b, o + 56),
    compressedSize: runsAt >= 0x48 ? u64(b, o + 64) : undefined,
    unit: u16(b, o + 34),
  };
}

/**
 * One attribute's fragments (from the base record and its extensions) as one stream. The sizes
 * come from the fragment that starts at cluster 0.
 * @param {Attribute[]} fragments @returns {Stream | undefined}
 */
export function streamOf(fragments) {
  const sorted = [...fragments].sort((a, b) => a.startVcn - b.startVcn);
  const first = sorted[0];
  if (!first) return undefined;
  const common = {
    compressed: !!(first.flags & 0x0001),
    sparse: !!(first.flags & 0x8000),
    encrypted: !!(first.flags & 0x4000),
  };
  if (first.resident)
    return {
      resident: first.value,
      runs: [],
      size: first.size,
      initialized: first.size,
      allocated: first.size,
      unit: 0,
      ...common,
    };
  return {
    runs: sorted.flatMap((f) => (f.resident ? [] : f.runs)),
    size: first.size,
    initialized: Math.min(first.initialized, first.size),
    allocated: first.allocated,
    compressedSize: first.compressedSize,
    unit: common.compressed ? first.unit : 0,
    ...common,
  };
}

/** The unnamed attributes of `type` in a record. @param {MftRecord} record @param {number} type */
export const unnamed = (record, type) =>
  record.attributes.filter((a) => a.type === type && a.name === "");
