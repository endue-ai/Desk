// A ZIP reader for the packages documents are stored in (OOXML, ODF, HWPX, Pages): the central
// directory, stored and deflated entries (DecompressionStream "deflate-raw"). ZIP64 and encrypted
// entries are not read.
import { decode, inflate, Reader } from "./bytes.js";
import { DocError, ENCRYPTED } from "./model.js";

/** @typedef {{ name: string, method: number, flags: number, compressed: number, size: number, offset: number }} ZipEntry */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export const isZip = (/** @type {Uint8Array} */ bytes) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);

export class Zip {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    const r = new Reader(bytes);
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (r.u32(at) === EOCD) {
        end = at;
        break;
      }
    }
    if (end < 0) throw new DocError("This file is damaged: its ZIP directory is missing.");
    const count = r.u16(end + 10);
    let at = r.u32(end + 16);
    /** @type {Map<string, ZipEntry>} */
    this.entries = new Map();
    /** @type {Map<string, string>} */
    this.folded = new Map();
    for (let i = 0; i < count; i++) {
      if (r.u32(at) !== CENTRAL)
        throw new DocError("This file is damaged: its ZIP directory is broken.");
      const nameLength = r.u16(at + 28);
      const flags = r.u16(at + 8);
      const raw = bytes.subarray(at + 46, at + 46 + nameLength);
      const name = normalize(decode(raw));
      /** @type {ZipEntry} */
      const entry = {
        name,
        method: r.u16(at + 10),
        flags,
        compressed: r.u32(at + 20),
        size: r.u32(at + 24),
        offset: r.u32(at + 42),
      };
      this.entries.set(name, entry);
      this.folded.set(name.toLowerCase(), name);
      at += 46 + nameLength + r.u16(at + 30) + r.u16(at + 32);
    }
  }

  /** @param {string} name */
  entry(name) {
    const key = normalize(name);
    return this.entries.get(key) ?? this.entries.get(this.folded.get(key.toLowerCase()) ?? "");
  }

  /** @param {string} name */
  has(name) {
    return this.entry(name) !== undefined;
  }

  names() {
    return [...this.entries.keys()];
  }

  /**
   * The entry's bytes, or undefined when there is none.
   * @param {string} name
   * @returns {Promise<Uint8Array | undefined>}
   */
  async read(name) {
    const entry = this.entry(name);
    if (!entry) return undefined;
    if (entry.flags & 1) throw new DocError(ENCRYPTED);
    const r = new Reader(this.bytes);
    if (r.u32(entry.offset) !== LOCAL)
      throw new DocError(`This file is damaged: ${entry.name} is missing.`);
    const start = entry.offset + 30 + r.u16(entry.offset + 26) + r.u16(entry.offset + 28);
    const data = this.bytes.subarray(start, start + entry.compressed);
    if (data.length < entry.compressed)
      throw new DocError("This file is damaged: it ends too early.");
    if (entry.method === 0) return data;
    if (entry.method !== 8)
      throw new DocError(
        `This file uses a ZIP compression method (${entry.method}) Docs does not read.`,
      );
    try {
      return await inflate(data, "deflate-raw");
    } catch {
      throw new DocError(`This file is damaged: ${entry.name} does not decompress.`);
    }
  }

  /** @param {string} name @returns {Promise<string | undefined>} */
  async text(name) {
    const bytes = await this.read(name);
    return bytes === undefined ? undefined : decode(stripBom(bytes));
  }
}

const stripBom = (/** @type {Uint8Array} */ b) =>
  b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;

const normalize = (/** @type {string} */ name) => name.replace(/\\/g, "/").replace(/^\/+/, "");

/**
 * A package path relative to the part that names it: "word/document.xml" + "media/a.png" is
 * "word/media/a.png"; "/x" is absolute; ".." climbs.
 * @param {string} base
 * @param {string} target
 */
export function resolvePath(base, target) {
  const clean = decodeURIComponentSafe(target.split("#")[0] ?? "");
  const parts = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const decodeURIComponentSafe = (/** @type {string} */ s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
