// ZIP archives (EPUB, XPS, CBZ): the central directory, ZIP64 sizes, stored and deflated entries.
// Deflate is the platform's DecompressionStream("deflate-raw"); other methods and encrypted
// entries say so in words.
import { Unreadable } from "./errors.js";

/**
 * @typedef {{ name: string, method: number, flags: number, compressed: number, size: number,
 *   offset: number }} ZipEntry
 * @typedef {{ names: string[], has(name: string): boolean, entry(name: string): ZipEntry | undefined,
 *   read(name: string, signal?: AbortSignal): Promise<Uint8Array>, text(name: string, signal?: AbortSignal): Promise<string> }} Zip
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

/** Random access keeps a ZIP's unused entries outside memory. */
const sourceOf = (input) =>
  input instanceof Uint8Array
    ? { size: input.length, read: async (offset, length) => input.slice(offset, offset + length) }
    : input;

/** The directory is named by the end record; ZIP64 holds its wide fields separately. */
async function directory(source) {
  const tail = await source.read(Math.max(0, source.size - 65557), Math.min(source.size, 65557));
  const v = view(tail);
  for (let at = tail.length - 22; at >= 0; at--) {
    if (v.getUint32(at, true) !== EOCD) continue;
    if (at + 22 + v.getUint16(at + 20, true) !== tail.length) continue;
    let count = v.getUint16(at + 10, true);
    let size = v.getUint32(at + 12, true);
    let start = v.getUint32(at + 16, true);
    if (count === 0xffff || start === 0xffffffff || size === 0xffffffff) {
      if (at < 20 || v.getUint32(at - 20, true) !== ZIP64_LOCATOR)
        throw new Unreadable("The archive is damaged: its ZIP64 directory is missing.");
      const wide = view(await source.read(u64(v, at - 12), 56));
      if (wide.byteLength < 56 || wide.getUint32(0, true) !== 0x06064b50)
        throw new Unreadable("The archive is damaged: its ZIP64 directory is incomplete.");
      count = u64(wide, 32);
      size = u64(wide, 40);
      start = u64(wide, 48);
    }
    if (![count, size, start].every(Number.isSafeInteger) || start + size > source.size)
      throw new Unreadable("The archive is damaged: its directory is outside the file.");
    return { count, start, size };
  }
  throw new Unreadable("The archive is damaged: it has no central directory.");
}

/** @param {Uint8Array | import("@endue-ai/plugin-sdk").ByteSource} input @returns {Promise<Zip>} */
export async function readZip(input) {
  const source = sourceOf(input);
  const { count, start, size: length } = await directory(source);
  const bytes = await source.read(start, length);
  const v = view(bytes);
  /** @type {Map<string, ZipEntry>} */
  const entries = new Map();
  /** Lower-cased names, for hrefs whose case differs from the archive's. */
  const folded = new Map();
  let at = 0;
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

  /** @param {string} name @param {AbortSignal} [signal] */
  const read = async (name, signal) => {
    signal?.throwIfAborted();
    const found = entry(name);
    if (!found) throw new Unreadable(`The archive has no ${name}.`);
    if (found.flags & 1) throw new Unreadable("The archive is encrypted.");
    const head = view(await source.read(found.offset, 30, signal));
    if (head.byteLength < 30 || head.getUint32(0, true) !== LOCAL)
      throw new Unreadable("The archive is damaged.");
    const data = found.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    if (!Number.isSafeInteger(found.compressed) || data + found.compressed > source.size)
      throw new Unreadable("The archive is damaged: an entry is outside the file.");
    const body = await source.read(data, found.compressed, signal);
    signal?.throwIfAborted();
    if (found.method === 0) return body;
    if (found.method !== 8)
      throw new Unreadable(
        `${name} is compressed with a method the reader does not read (${found.method}).`,
      );
    try {
      return await inflate(body, signal);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      throw new Unreadable(`The archive is damaged: ${name} does not decompress.`);
    }
  };

  return {
    names: [...entries.keys()],
    has: (name) => entry(name) !== undefined,
    entry,
    read,
    text: async (name, signal) => new TextDecoder().decode(await read(name, signal)),
  };
}

/** Raw deflate, through the platform's decompression stream; the writer is not awaited, so the
 * reader drains it and back-pressure never stalls. */
export async function inflate(
  /** @type {Uint8Array} */ body,
  /** @type {AbortSignal | undefined} */ signal = undefined,
) {
  signal?.throwIfAborted();
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(/** @type {Uint8Array<ArrayBuffer>} */ (body)).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
    void writer.abort(signal.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const chunks = [];
    let length = 0;
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      signal?.throwIfAborted();
      chunks.push(next.value);
      length += next.value.length;
    }
    signal?.throwIfAborted();
    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** Whether these bytes start like a ZIP archive. */
export const isZip = (/** @type {Uint8Array} */ b) =>
  b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
