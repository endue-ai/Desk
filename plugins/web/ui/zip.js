// A ZIP reader for MAFF: the central directory (ZIP64 too), stored and deflated entries, read
// one at a time when asked for.
import { inflateRaw } from "./inflate.js";

/** @typedef {{ name: string, size: number, encrypted: boolean, read(): Uint8Array }} ZipEntry */

const u16 = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;
const u64 = (/** @type {Uint8Array} */ b, /** @type {number} */ at) =>
  u32(b, at) + u32(b, at + 4) * 2 ** 32;

/** @param {Uint8Array} bytes @param {number} at */
const name = (bytes, at, length, utf8 = true) => {
  const raw = bytes.subarray(at, at + length);
  if (utf8) return new TextDecoder().decode(raw);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder("ibm866").decode(raw);
  }
};

/**
 * The entries of a ZIP archive, in central directory order.
 * @param {Uint8Array} bytes
 * @returns {ZipEntry[]}
 */
export function readZip(bytes) {
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(bytes, at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error("The ZIP archive has no central directory.");
  let count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const locator = eocd - 20;
  if (
    (count === 0xffff || offset === 0xffffffff) &&
    locator >= 0 &&
    u32(bytes, locator) === 0x07064b50
  ) {
    const zip64 = u64(bytes, locator + 8);
    if (u32(bytes, zip64) === 0x06064b50) {
      count = u64(bytes, zip64 + 32);
      offset = u64(bytes, zip64 + 48);
    }
  }
  /** @type {ZipEntry[]} */
  const entries = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error("The ZIP archive's directory is damaged.");
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    let packed = u32(bytes, at + 20);
    let size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    let local = u32(bytes, at + 42);
    const entryName = name(bytes, at + 46, nameLength, (flags & 0x800) !== 0);
    // ZIP64: the sizes and offset that did not fit come from the 0x0001 extra field, in order.
    for (let x = at + 46 + nameLength; x + 4 <= at + 46 + nameLength + extraLength; ) {
      const id = u16(bytes, x);
      const length = u16(bytes, x + 2);
      if (id === 1) {
        let y = x + 4;
        if (size === 0xffffffff) {
          size = u64(bytes, y);
          y += 8;
        }
        if (packed === 0xffffffff) {
          packed = u64(bytes, y);
          y += 8;
        }
        if (local === 0xffffffff) local = u64(bytes, y);
      }
      x += 4 + length;
    }
    const encrypted = (flags & 1) !== 0;
    const start = local;
    entries.push({
      name: entryName,
      size,
      encrypted,
      read: () => {
        if (encrypted) throw new Error(`${entryName} is encrypted.`);
        if (u32(bytes, start) !== 0x04034b50) throw new Error(`${entryName} is damaged.`);
        const data = start + 30 + u16(bytes, start + 26) + u16(bytes, start + 28);
        if (method === 0) return bytes.subarray(data, data + packed);
        if (method === 8) return inflateRaw(bytes, data, size).data;
        throw new Error(`${entryName} uses a compression method Web does not read.`);
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
