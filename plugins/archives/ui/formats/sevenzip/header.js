// The 7z header's properties: pack info, folders (coder chains), substreams and files info, as
// 7zFormat.txt lays them out. Pure parsing of the header's bytes; no decoding here.
import { fileTime, u32, utf16le } from "../../bytes.js";

const END = 0x00;
const HEADER = 0x01;
const ARCHIVE_PROPERTIES = 0x02;
const ADDITIONAL_STREAMS = 0x03;
const MAIN_STREAMS = 0x04;
const FILES_INFO = 0x05;
const PACK_INFO = 0x06;
const UNPACK_INFO = 0x07;
const SUBSTREAMS_INFO = 0x08;
const SIZE = 0x09;
const CRC = 0x0a;
const FOLDER = 0x0b;
const CODERS_UNPACK_SIZE = 0x0c;
const NUM_UNPACK_STREAM = 0x0d;
const EMPTY_STREAM = 0x0e;
const EMPTY_FILE = 0x0f;
const ANTI = 0x10;
const NAME = 0x11;
const MTIME = 0x14;
const ATTRIBUTES = 0x15;
export const ENCODED_HEADER = 0x17;

/**
 * @typedef {{ id: string, ins: number, outs: number, props: Uint8Array }} Coder
 * @typedef {{
 *   coders: Coder[],
 *   binds: Array<{ in: number, out: number }>,
 *   packed: number[],
 *   sizes: number[],
 *   crc?: number,
 * }} Folder `packed` lists the coder in-streams fed from pack streams, `sizes` every out-stream's size
 * @typedef {{
 *   packPos: number,
 *   packSizes: number[],
 *   folders: Folder[],
 *   counts: number[],
 *   sizes: number[],
 *   crcs: Array<number | undefined>,
 * }} Streams `counts`, `sizes` and `crcs` describe the substreams (the files' data) folder by folder
 * @typedef {{ name: string, empty: boolean, emptyFile: boolean, anti: boolean, date?: Date, attrib?: number }} FileInfo
 */

const bad = () => new Error("The 7z header is damaged.");

class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.b = bytes;
    this.pos = 0;
  }
  byte() {
    if (this.pos >= this.b.length) throw bad();
    return /** @type {number} */ (this.b[this.pos++]);
  }
  /** 7z's variable-length number: the first byte's leading ones count the bytes that follow. */
  number() {
    const first = this.byte();
    let mask = 0x80;
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) return value + (first & (mask - 1)) * 2 ** (8 * i);
      value += this.byte() * 2 ** (8 * i);
      mask >>>= 1;
    }
    return value;
  }
  u32() {
    const value = u32(this.b, this.pos);
    this.skip(4);
    return value;
  }
  /** @param {number} n */
  bytes(n) {
    if (n < 0 || this.pos + n > this.b.length) throw bad();
    this.pos += n;
    return this.b.subarray(this.pos - n, this.pos);
  }
  /** @param {number} n */
  skip(n) {
    this.bytes(n);
  }
  /** A bit vector of `n` bits, most significant bit first. @param {number} n */
  bits(n) {
    const bytes = this.bytes(Math.ceil(n / 8));
    return Array.from({ length: n }, (_, i) => (((bytes[i >> 3] ?? 0) >> (7 - (i & 7))) & 1) === 1);
  }
  /** "All defined" or a bit vector. @param {number} n */
  defined(n) {
    return this.byte() ? new Array(n).fill(true) : this.bits(n);
  }
  /** CRCs for the defined of `n` items. @param {number} n */
  digests(n) {
    const defined = this.defined(n);
    return defined.map((d) => (d ? this.u32() : undefined));
  }
  /** Pass over a property's data: its size, then the bytes. */
  skipData() {
    this.skip(this.number());
  }
}

/** @param {Reader} r */
function readFolder(r) {
  /** @type {Coder[]} */
  const coders = [];
  const count = r.number();
  if (count < 1 || count > 64) throw bad();
  for (let i = 0; i < count; i++) {
    const flags = r.byte();
    if (flags & 0x80) throw new Error("This 7z uses alternative methods, which are not read here.");
    const id = [...r.bytes(flags & 0x0f)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const complex = flags & 0x10;
    const ins = complex ? r.number() : 1;
    const outs = complex ? r.number() : 1;
    const props = flags & 0x20 ? r.bytes(r.number()) : new Uint8Array(0);
    coders.push({ id, ins, outs, props });
  }
  const ins = coders.reduce((n, c) => n + c.ins, 0);
  const outs = coders.reduce((n, c) => n + c.outs, 0);
  const binds = Array.from({ length: outs - 1 }, () => ({ in: r.number(), out: r.number() }));
  const packedCount = ins - binds.length;
  if (packedCount < 1) throw bad();
  /** @type {number[]} */
  let packed = [];
  if (packedCount === 1) {
    for (let i = 0; i < ins; i++) if (!binds.some((b) => b.in === i)) packed = [i];
  } else packed = Array.from({ length: packedCount }, () => r.number());
  return /** @type {Folder} */ ({ coders, binds, packed, sizes: [] });
}

/** The out-stream no bind consumes: the folder's output. @param {Folder} folder */
export function mainOut(folder) {
  const outs = folder.coders.reduce((n, c) => n + c.outs, 0);
  for (let i = 0; i < outs; i++) if (!folder.binds.some((b) => b.out === i)) return i;
  throw bad();
}

/** @param {Folder} folder */
export const folderSize = (folder) => folder.sizes[mainOut(folder)] ?? 0;

/** @param {Reader} r @returns {Streams} */
function readStreams(r) {
  /** @type {Streams} */
  const s = { packPos: 0, packSizes: [], folders: [], counts: [], sizes: [], crcs: [] };
  let type = r.number();
  if (type === PACK_INFO) {
    s.packPos = r.number();
    const count = r.number();
    for (type = r.number(); type !== END; type = r.number()) {
      if (type === SIZE) s.packSizes = Array.from({ length: count }, () => r.number());
      else if (type === CRC) r.digests(count);
      else r.skipData();
    }
    type = r.number();
  }
  if (type === UNPACK_INFO) {
    if (r.number() !== FOLDER) throw bad();
    const count = r.number();
    if (r.byte() !== 0)
      throw new Error("This 7z keeps its folders elsewhere, which is not read here.");
    s.folders = Array.from({ length: count }, () => readFolder(r));
    if (r.number() !== CODERS_UNPACK_SIZE) throw bad();
    for (const folder of s.folders)
      folder.sizes = Array.from({ length: folder.coders.reduce((n, c) => n + c.outs, 0) }, () =>
        r.number(),
      );
    for (type = r.number(); type !== END; type = r.number()) {
      if (type === CRC) {
        const crcs = r.digests(count);
        s.folders.forEach((folder, i) => {
          if (crcs[i] !== undefined) folder.crc = crcs[i];
        });
      } else r.skipData();
    }
    type = r.number();
  }
  s.counts = s.folders.map(() => 1);
  if (type === SUBSTREAMS_INFO) {
    type = r.number();
    if (type === NUM_UNPACK_STREAM) {
      s.counts = s.folders.map(() => r.number());
      type = r.number();
    }
    s.folders.forEach((folder, f) => {
      const n = /** @type {number} */ (s.counts[f]);
      if (n === 0) return;
      let sum = 0;
      if (type === SIZE)
        for (let j = 1; j < n; j++) {
          const size = r.number();
          s.sizes.push(size);
          sum += size;
        }
      s.sizes.push(folderSize(folder) - sum);
    });
    if (type === SIZE) type = r.number();
    const needs = (/** @type {number} */ f) => s.counts[f] !== 1 || s.folders[f]?.crc === undefined;
    const wanted = s.folders.reduce((n, _, f) => n + (needs(f) ? (s.counts[f] ?? 0) : 0), 0);
    /** @type {Array<number | undefined>} */
    let digests = [];
    for (; type !== END; type = r.number()) {
      if (type === CRC) digests = r.digests(wanted);
      else r.skipData();
    }
    s.folders.forEach((folder, f) => {
      if (!needs(f)) s.crcs.push(folder.crc);
      else for (let j = 0; j < (s.counts[f] ?? 0); j++) s.crcs.push(digests.shift());
    });
    type = r.number();
  } else {
    s.sizes = s.folders.map(folderSize);
    s.crcs = s.folders.map((f) => f.crc);
  }
  if (type !== END) throw bad();
  return s;
}

/** @param {Reader} r @returns {FileInfo[]} */
function readFiles(r) {
  const count = r.number();
  /** @type {FileInfo[]} */
  const files = Array.from({ length: count }, () => ({
    name: "",
    empty: false,
    emptyFile: false,
    anti: false,
  }));
  /** @type {number[]} */
  let empties = [];
  for (let type = r.number(); type !== END; type = r.number()) {
    const size = r.number();
    const sub = new Reader(r.bytes(size));
    if (type === EMPTY_STREAM) {
      const bits = sub.bits(count);
      empties = [];
      bits.forEach((empty, i) => {
        if (!empty) return;
        /** @type {FileInfo} */ (files[i]).empty = true;
        empties.push(i);
      });
    } else if (type === EMPTY_FILE || type === ANTI) {
      sub.bits(empties.length).forEach((on, k) => {
        const file = /** @type {FileInfo} */ (files[/** @type {number} */ (empties[k])]);
        if (type === EMPTY_FILE) file.emptyFile = on;
        else file.anti = on;
      });
    } else if (type === NAME) {
      if (sub.byte() !== 0)
        throw new Error("This 7z keeps its names elsewhere, which is not read here.");
      const names = utf16le(sub.bytes(sub.b.length - 1)).split("\0");
      files.forEach((file, i) => {
        file.name = names[i] ?? "";
      });
    } else if (type === MTIME || type === ATTRIBUTES) {
      const defined = sub.defined(count);
      if (sub.byte() !== 0) continue;
      defined.forEach((on, i) => {
        if (!on) return;
        const file = /** @type {FileInfo} */ (files[i]);
        if (type === MTIME) {
          const low = sub.u32();
          file.date = fileTime(low, sub.u32());
        } else file.attrib = sub.u32();
      });
    }
  }
  return files;
}

/**
 * A header's bytes: either the header itself, or the streams that hold it encoded.
 * @param {Uint8Array} bytes
 * @returns {{ encoded: Streams } | { main?: Streams, files: FileInfo[] }}
 */
export function parseHeader(bytes) {
  const r = new Reader(bytes);
  let type = r.number();
  if (type === ENCODED_HEADER) return { encoded: readStreams(r) };
  if (type !== HEADER) throw bad();
  type = r.number();
  if (type === ARCHIVE_PROPERTIES) {
    for (let t = r.number(); t !== END; t = r.number()) r.skipData();
    type = r.number();
  }
  if (type === ADDITIONAL_STREAMS) {
    readStreams(r);
    type = r.number();
  }
  /** @type {Streams | undefined} */
  let main;
  if (type === MAIN_STREAMS) {
    main = readStreams(r);
    type = r.number();
  }
  /** @type {FileInfo[]} */
  let files = [];
  if (type === FILES_INFO) {
    files = readFiles(r);
    type = r.number();
  }
  if (type !== END) throw bad();
  return { main, files };
}
