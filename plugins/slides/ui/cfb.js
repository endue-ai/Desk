// A compound file (CFB, OLE2) reader: the FAT and mini FAT, the directory, and streams by name.
// PowerPoint 97-2003 files are compound files, and so are password-protected OOXML packages.
import { startsWith, u16, u32, utf16le } from "./bytes.js";

/** @typedef {{ name: string, type: number, start: number, size: number }} CfbEntry */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const LAST = 0xfffffff0;

/** @param {Uint8Array} b */
export const isCfb = (b) => startsWith(b, SIGNATURE);

/** @param {Uint8Array} bytes */
export function readCfb(bytes) {
  if (!isCfb(bytes) || bytes.length < 512) throw new Error("not a compound file");
  const sectorSize = 1 << u16(bytes, 30);
  const miniSize = 1 << u16(bytes, 32);
  if (sectorSize !== 512 && sectorSize !== 4096) throw new Error("damaged compound file header");
  const fatCount = u32(bytes, 44);
  const firstDir = u32(bytes, 48);
  const cutoff = u32(bytes, 56) || 4096;
  const firstMiniFat = u32(bytes, 60);
  let difat = u32(bytes, 68);
  const difatCount = u32(bytes, 72);
  const offsetOf = (/** @type {number} */ sector) => (sector + 1) * sectorSize;

  // The FAT's sectors: 109 in the header, the rest in a chain of DIFAT sectors.
  /** @type {number[]} */
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++)
    fatSectors.push(u32(bytes, 76 + i * 4));
  for (let n = 0; n < difatCount && difat < LAST && fatSectors.length < fatCount; n++) {
    const at = offsetOf(difat);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatSectors.length < fatCount; i++)
      fatSectors.push(u32(bytes, at + i * 4));
    difat = u32(bytes, at + per * 4);
  }
  const fat = new Uint32Array((fatSectors.length * sectorSize) / 4);
  fatSectors.forEach((sector, n) => {
    const at = offsetOf(sector);
    for (let i = 0; i < sectorSize / 4; i++) fat[n * (sectorSize / 4) + i] = u32(bytes, at + i * 4);
  });

  /** The sectors of a chain, guarded against loops. @param {number} start @param {Uint32Array} table */
  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let s = start; s < LAST; s = table[s] ?? LAST) {
      if (seen.has(s) || s >= table.length) break;
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  /** @param {number} start @param {number} size */
  const regular = (start, size) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => {
      out.set(bytes.subarray(offsetOf(s), offsetOf(s) + sectorSize), i * sectorSize);
    });
    return out.subarray(0, Math.min(size, out.length));
  };

  const dirBytes = regular(firstDir, Number.MAX_SAFE_INTEGER);
  /** @type {CfbEntry[]} */
  const entries = [];
  for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
    const length = u16(dirBytes, at + 64);
    const type = dirBytes[at + 66] ?? 0;
    if (length < 2 || type === 0) {
      entries.push({ name: "", type: 0, start: 0, size: 0 });
      continue;
    }
    const name = utf16le(dirBytes.subarray(at, at + Math.min(64, length - 2)));
    entries.push({ name, type, start: u32(dirBytes, at + 116), size: u32(dirBytes, at + 120) });
  }
  const root = entries[0];
  if (root?.type !== 5) throw new Error("damaged compound file directory");
  const miniStream = regular(root.start, root.size);
  const miniFatBytes =
    firstMiniFat < LAST ? regular(firstMiniFat, Number.MAX_SAFE_INTEGER) : new Uint8Array();
  const miniFat = new Uint32Array(miniFatBytes.length / 4);
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(miniFatBytes, i * 4);

  /** @param {CfbEntry} entry */
  const read = (entry) => {
    if (entry.size >= cutoff) return regular(entry.start, entry.size);
    const sectors = chain(entry.start, miniFat);
    const out = new Uint8Array(sectors.length * miniSize);
    sectors.forEach((s, i) => {
      out.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize);
    });
    return out.subarray(0, entry.size);
  };

  const streams = entries.filter((e) => e.type === 2);
  return {
    names: streams.map((e) => e.name),
    has: (/** @type {string} */ name) => streams.some((e) => e.name === name),
    /** A stream by name, anywhere in the file; null when there is none. @param {string} name */
    stream(name) {
      const entry = streams.find((e) => e.name === name);
      return entry ? read(entry) : null;
    },
  };
}
