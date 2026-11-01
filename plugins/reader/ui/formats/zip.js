// ZIP archives (EPUB, XPS, CBZ): the central directory, ZIP64 sizes, stored and deflated entries.
// Deflate is the platform's DecompressionStream("deflate-raw"); other methods and encrypted
// entries say so in words.
import { Unreadable } from "./errors.js";

/**
 * @typedef {{ name: string, method: number, flags: number, compressed: number, size: number,
 *   offset: number }} ZipEntry
 * @typedef {{ names: string[], has(name: string): boolean, entry(name: string): ZipEntry | undefined,
 *   read(name: string): Promise<Uint8Array>, text(name: string): Promise<string> }} Zip
 */

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const view = (/** @type {Uint8Array} */ b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** @param {DataView} v @param {number} at */
const u64 = (v, at) => v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;

function names(/** @type {Uint8Array} */ bytes, /** @type {boolean} */ utf8) {
  if (utf8) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The end of central directory record: where the directory starts and how many entries it has. */
function directory(/** @type {Uint8Array} */ bytes) {
  const v = view(bytes);
  const stop = Math.max(0, bytes.length - 22 - 65535);
  for (let at = bytes.length - 22; at >= stop; at--) {
    if (v.getUint32(at, true) !== EOCD) continue;
    let count = v.getUint16(at + 10, true);
    let start = v.getUint32(at + 16, true);
    if (
      (count === 0xffff || start === 0xffffffff) &&
      at >= 20 &&
      v.getUint32(at - 20, true) === ZIP64_LOCATOR
    ) {
      const end64 = u64(v, at - 12);
      if (end64 + 56 <= bytes.length) {
        count = u64(v, end64 + 32);
        start = u64(v, end64 + 48);
      }
    }
    return { count, start };
  }
  throw new Unreadable("The archive is damaged: it has no central directory.");
}

/** @param {Uint8Array} bytes @returns {Promise<Zip>} */
export async function readZip(bytes) {
  const v = view(bytes);
  const { count, start } = directory(bytes);
  /** @type {Map<string, ZipEntry>} */
  const entries = new Map();
  /** Lower-cased names, for hrefs whose case differs from the archive's. */
  const folded = new Map();
  let at = start;
  for (let i = 0; i < count && at + 46 <= bytes.length; i++) {
    if (v.getUint32(at, true) !== CENTRAL) throw new Unreadable("The archive is damaged.");
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    let compressed = v.getUint32(at + 20, true);
    let size = v.getUint32(at + 24, true);
    const nameLength = v.getUint16(at + 28, true);
    const extraLength = v.getUint16(at + 30, true);
    const commentLength = v.getUint16(at + 32, true);
    let offset = v.getUint32(at + 42, true);
    const raw = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = names(raw, (flags & 0x800) !== 0)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    // ZIP64: the sizes and offset that did not fit are in the 0x0001 extra field, in this order.
    for (let e = at + 46 + nameLength; e + 4 <= at + 46 + nameLength + extraLength; ) {
      const id = v.getUint16(e, true);
      const length = v.getUint16(e + 2, true);
      if (id === 1) {
        let field = e + 4;
        if (size === 0xffffffff) [size, field] = [u64(v, field), field + 8];
        if (compressed === 0xffffffff) [compressed, field] = [u64(v, field), field + 8];
        if (offset === 0xffffffff) offset = u64(v, field);
      }
      e += 4 + length;
    }
    if (!name.endsWith("/")) {
      entries.set(name, { name, method, flags, compressed, size, offset });
      folded.set(name.toLowerCase(), name);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }

  const entry = (/** @type {string} */ name) =>
    entries.get(name) ?? entries.get(folded.get(name.toLowerCase()) ?? "");

  /** @param {string} name */
  const read = async (name) => {
    const found = entry(name);
    if (!found) throw new Unreadable(`The archive has no ${name}.`);
    if (found.flags & 1) throw new Unreadable("The archive is encrypted.");
    if (v.getUint32(found.offset, true) !== LOCAL) throw new Unreadable("The archive is damaged.");
    const data =
      found.offset +
      30 +
      v.getUint16(found.offset + 26, true) +
      v.getUint16(found.offset + 28, true);
    const body = bytes.subarray(data, data + found.compressed);
    if (found.method === 0) return body;
    if (found.method !== 8)
      throw new Unreadable(
        `${name} is compressed with a method the reader does not read (${found.method}).`,
      );
    try {
      return await inflate(body);
    } catch {
      throw new Unreadable(`The archive is damaged: ${name} does not decompress.`);
    }
  };

  return {
    names: [...entries.keys()],
    has: (name) => entry(name) !== undefined,
    entry,
    read,
    text: async (name) => new TextDecoder().decode(await read(name)),
  };
}

/** Raw deflate, through the platform's decompression stream; the writer is not awaited, so the
 * reader drains it and back-pressure never stalls. */
export async function inflate(/** @type {Uint8Array} */ body) {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(/** @type {Uint8Array<ArrayBuffer>} */ (body)).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let length = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    chunks.push(next.value);
    length += next.value.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Whether these bytes start like a ZIP archive. */
export const isZip = (/** @type {Uint8Array} */ b) =>
  b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
