// A compound file (MS-CFB) reader: the container of Word 97 (.doc), HWP 5.0, Works and encrypted
// Office packages. The FAT and DIFAT chains, the directory's sibling trees as "a/b" paths, and the
// mini stream for small streams. Chains that loop or run past the file are cut, never followed.
import { Reader, startsWith } from "./bytes.js";
import { DocError } from "./model.js";

const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const LAST = 0xfffffffa;
const NONE = 0xffffffff;

export const isCfb = (/** @type {Uint8Array} */ bytes) => startsWith(bytes, MAGIC);

/** @typedef {{ name: string, type: number, start: number, size: number, left: number, right: number, child: number }} DirEntry */

export class Cfb {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    if (!isCfb(bytes)) throw new DocError("This file is not a compound file.");
    this.bytes = bytes;
    const r = new Reader(bytes);
    this.r = r;
    this.sector = 1 << r.u16(30);
    this.mini = 1 << r.u16(32);
    if (this.sector !== 512 && this.sector !== 4096)
      throw new DocError("This file is damaged: its compound file header is broken.");
    this.cutoff = r.u32(56) || 4096;
    this.count = Math.ceil((bytes.length - this.sector) / this.sector);

    // The FAT's own sectors: 109 in the header, the rest in the DIFAT chain.
    /** @type {number[]} */
    const fatSectors = [];
    for (let i = 0; i < 109; i++) fatSectors.push(r.u32(76 + i * 4));
    let difat = r.u32(68);
    for (let guard = 0; difat < LAST && guard < this.count; guard++) {
      const at = this.offset(difat);
      const per = this.sector / 4 - 1;
      for (let i = 0; i < per; i++) fatSectors.push(r.u32(at + i * 4));
      difat = r.u32(at + per * 4);
    }
    const fatCount = Math.min(r.u32(44), fatSectors.length);
    const per = this.sector / 4;
    this.fat = new Uint32Array(fatCount * per);
    for (let i = 0; i < fatCount; i++) {
      const at = this.offset(fatSectors[i] ?? NONE);
      for (let j = 0; j < per; j++) this.fat[i * per + j] = r.u32(at + j * 4);
    }

    const dir = this.chainBytes(r.u32(48));
    const dr = new Reader(dir);
    /** @type {DirEntry[]} */
    this.dir = [];
    for (let at = 0; at + 128 <= dir.length; at += 128) {
      const nameLength = Math.min(64, dr.u16(at + 64));
      let name = "";
      for (let i = 0; i + 2 < nameLength; i += 2) name += String.fromCharCode(dr.u16(at + i));
      this.dir.push({
        name,
        type: dr.u8(at + 66),
        left: dr.u32(at + 68),
        right: dr.u32(at + 72),
        child: dr.u32(at + 76),
        start: dr.u32(at + 116),
        size: dr.u32(at + 120),
      });
    }
    const root = this.dir[0];
    if (root?.type !== 5) throw new DocError("This file is damaged: its directory is broken.");
    this.miniStream = this.chainBytes(root.start).subarray(0, root.size);
    const miniFat = this.chainBytes(r.u32(60));
    const mr = new Reader(miniFat);
    this.miniFat = new Uint32Array(miniFat.length / 4);
    for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = mr.u32(i * 4);

    /** Stream and storage paths ("BodyText/Section0"), lower-cased, to their entries. */
    /** @type {Map<string, DirEntry>} */
    this.paths = new Map();
    /** @type {string[]} */
    this.streams = [];
    /** @type {Set<number>} */
    const seen = new Set();
    const walk = (/** @type {number} */ id, /** @type {string} */ prefix) => {
      const entry = id < LAST ? this.dir[id] : undefined;
      if (!entry || seen.has(id)) return;
      seen.add(id);
      walk(entry.left, prefix);
      const path = prefix + entry.name;
      this.paths.set(path.toLowerCase(), entry);
      if (entry.type === 2) this.streams.push(path);
      if (entry.type === 1) walk(entry.child, `${path}/`);
      walk(entry.right, prefix);
    };
    walk(root.child, "");
  }

  /** @param {number} sector */
  offset(sector) {
    return (sector + 1) * this.sector;
  }

  /** The sectors of a chain, concatenated. @param {number} start */
  chainBytes(start) {
    /** @type {Uint8Array[]} */
    const parts = [];
    let at = start;
    for (let guard = 0; at < LAST && guard <= this.count; guard++) {
      const from = this.offset(at);
      if (from >= this.bytes.length) break;
      parts.push(this.bytes.subarray(from, from + this.sector));
      at = this.fat[at] ?? NONE;
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const part of parts) {
      out.set(part, o);
      o += part.length;
    }
    return out;
  }

  /** @param {DirEntry} entry */
  miniBytes(entry) {
    const out = new Uint8Array(entry.size);
    let at = entry.start;
    let o = 0;
    for (let guard = 0; at < LAST && o < entry.size && guard <= this.miniFat.length; guard++) {
      const from = at * this.mini;
      const part = this.miniStream.subarray(from, from + Math.min(this.mini, entry.size - o));
      out.set(part, o);
      o += part.length;
      at = this.miniFat[at] ?? NONE;
    }
    return out.subarray(0, o);
  }

  /** @param {string} path */
  has(path) {
    return this.paths.has(path.toLowerCase());
  }

  /** Every stream path, as the file spells it. */
  list() {
    return this.streams;
  }

  /**
   * A stream's bytes, or undefined when there is none.
   * @param {string} path
   * @returns {Uint8Array | undefined}
   */
  read(path) {
    const entry = this.paths.get(path.toLowerCase());
    if (entry?.type !== 2) return undefined;
    if (entry.size < this.cutoff) return this.miniBytes(entry);
    return this.chainBytes(entry.start).subarray(0, entry.size);
  }
}
