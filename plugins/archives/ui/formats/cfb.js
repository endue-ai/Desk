// The compound file (OLE2, CFB): sectors chained by a FAT, a directory tree of storages and
// streams, small streams in a mini stream. Read by ranges: the FAT, the directory, then a stream's
// sectors only when it is read.
import { at, u16, u32, utf16le } from "../bytes.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {{ path: string, size: number, start: number, storage: boolean }} CfbStream */

const END = 0xfffffffe;
const FREE = 0xffffffff;

/** @param {Source} source */
export async function openCfb(source) {
  const head = await source.read(0, 512);
  if (!at(head, 0, "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"))
    throw new Error("This is not a compound file.");
  const shift = u16(head, 30);
  if (shift !== 9 && shift !== 12) throw new Error("The compound file's sector size is damaged.");
  const sector = 1 << shift;
  const miniShift = u16(head, 32);
  const cutoff = u32(head, 56);
  const offsetOf = (/** @type {number} */ n) => (n + 1) * sector;
  const count = Math.ceil(Math.max(0, source.size - sector) / sector);

  // The FAT's own sectors: 109 in the header, the rest through the DIFAT chain.
  /** @type {number[]} */
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const n = u32(head, 76 + i * 4);
    if (n < END) fatSectors.push(n);
  }
  let difat = u32(head, 68);
  for (let guard = 0; difat < END && guard < count; guard++) {
    const b = await source.read(offsetOf(difat), sector);
    for (let i = 0; i < sector / 4 - 1; i++) {
      const n = u32(b, i * 4);
      if (n < END) fatSectors.push(n);
    }
    difat = u32(b, sector - 4);
  }
  const fat = new Uint32Array(fatSectors.length * (sector / 4));
  for (const [i, n] of fatSectors.entries()) {
    const b = await source.read(offsetOf(n), sector);
    for (let j = 0; j < sector / 4; j++) fat[i * (sector / 4) + j] = u32(b, j * 4);
  }

  /** The sectors of a chain, in order; throws on a loop. @param {Uint32Array} table @param {number} first */
  const chain = (table, first) => {
    /** @type {number[]} */
    const out = [];
    for (let n = first; n < END && n !== FREE; n = table[n] ?? END) {
      if (out.length > table.length) throw new Error("The compound file's sector chain loops.");
      out.push(n);
    }
    return out;
  };
  /** Read a chain's bytes, contiguous runs in one read. @param {number[]} sectors @param {number} size */
  const readChain = async (sectors, size) => {
    const out = new Uint8Array(Math.min(size, sectors.length * sector));
    for (let i = 0; i < sectors.length && i * sector < out.length; ) {
      let j = i + 1;
      while (j < sectors.length && sectors[j] === (sectors[j - 1] ?? 0) + 1) j++;
      const length = Math.min((j - i) * sector, out.length - i * sector);
      out.set(await source.read(offsetOf(sectors[i] ?? 0), length), i * sector);
      i = j;
    }
    return out;
  };

  const dirSectors = chain(fat, u32(head, 48));
  const dir = await readChain(dirSectors, dirSectors.length * sector);
  const entryAt = (/** @type {number} */ i) => dir.subarray(i * 128, i * 128 + 128);
  const root = entryAt(0);

  /** @type {CfbStream[]} */
  const streams = [];
  const seen = new Set();
  /** Walk the red-black tree of a storage's children. @param {number} i @param {string} prefix */
  const walk = (i, prefix) => {
    const stack = [i];
    while (stack.length) {
      const n = /** @type {number} */ (stack.pop());
      if (n === FREE || seen.has(n) || (n + 1) * 128 > dir.length) continue;
      seen.add(n);
      const e = entryAt(n);
      const length = Math.max(0, Math.min(64, u16(e, 64)) - 2);
      const name = utf16le(e.subarray(0, length));
      const type = e[66] ?? 0;
      const path = prefix ? `${prefix}/${name}` : name;
      if (type === 2)
        streams.push({
          path,
          size: u32(e, 120) + (shift === 12 ? u32(e, 124) * 0x100000000 : 0),
          start: u32(e, 116),
          storage: false,
        });
      if (type === 1) walk(u32(e, 76), path);
      stack.push(u32(e, 68), u32(e, 72));
    }
  };
  walk(u32(root, 76), "");

  /** @type {Uint32Array | undefined} */
  let miniFat;
  /** @type {number[] | undefined} */
  let miniSectors;
  /** The bytes of one stream (its first `limit` bytes). @param {CfbStream} stream @param {number} limit */
  const read = async (stream, limit) => {
    const size = Math.min(stream.size, limit);
    if (stream.size >= cutoff) return readChain(chain(fat, stream.start), size);
    if (!miniFat) {
      const sectors = chain(fat, u32(head, 60));
      const bytes = await readChain(sectors, sectors.length * sector);
      miniFat = new Uint32Array(bytes.length / 4);
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(bytes, i * 4);
      miniSectors = chain(fat, u32(root, 116));
    }
    const mini = 1 << miniShift;
    const out = new Uint8Array(size);
    let at = 0;
    for (const n of chain(miniFat, stream.start)) {
      if (at >= size) break;
      const position = n * mini;
      const big = miniSectors?.[Math.floor(position / sector)];
      if (big === undefined) throw new Error("The compound file's mini stream is damaged.");
      const part = await source.read(
        offsetOf(big) + (position % sector),
        Math.min(mini, size - at),
      );
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  return { streams, read };
}
