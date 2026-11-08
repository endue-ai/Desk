// A ZIP reader: the central directory, stored and deflated entries (inflated with the platform's
// DecompressionStream), names compared without case as OPC does. Entries are read when asked for.
import { u16, u32, utf8 } from "./bytes.js";

/**
 * @typedef {{ name: string, method: number, flags: number, compressed: number, size: number, offset: number }} ZipEntry
 * @typedef {{
 *   names: string[],
 *   has(name: string): boolean,
 *   encrypted(name: string): boolean,
 *   bytes(name: string): Promise<Uint8Array>,
 *   text(name: string): Promise<string>,
 * }} Zip
 */

/** Whether the bytes start like a ZIP. @param {Uint8Array} b */
export const isZip = (b) =>
  b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);

/** Inflate raw deflate data. @param {Uint8Array} data @param {number} size */
async function inflate(data, size) {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // Write and read at once: a stream that is not read applies back pressure and never finishes.
  const written = writer
    .write(/** @type {Uint8Array<ArrayBuffer>} */ (data))
    .then(() => writer.close());
  written.catch(() => {});
  const reader = stream.readable.getReader();
  const out = new Uint8Array(size);
  let at = 0;
  /** @type {Uint8Array[]} */
  const extra = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length <= out.length) out.set(value, at);
    else extra.push(value);
    at += value.length;
  }
  await written;
  if (extra.length === 0) return at === size ? out : out.subarray(0, at);
  const all = new Uint8Array(at);
  all.set(out.subarray(0, Math.min(at, size)));
  let k = size;
  for (const chunk of extra) {
    all.set(chunk, k);
    k += chunk.length;
  }
  return all;
}

/** @param {Uint8Array} bytes @returns {Zip} */
export function readZip(bytes) {
  // The end of central directory record is in the last 64 KB + 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("its ZIP directory is missing");
  let count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  // ZIP64: the locator just before the end record points at the larger record.
  if ((count === 0xffff || at === 0xffffffff) && u32(bytes, end - 20) === 0x07064b50) {
    const record = u32(bytes, end - 12);
    count = u32(bytes, record + 32);
    at = u32(bytes, record + 48);
  }
  /** @type {Map<string, ZipEntry>} */
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(bytes, at) !== 0x02014b50) throw new Error("its ZIP directory is broken");
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const raw = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = utf8(raw);
    /** @type {ZipEntry} */
    const entry = {
      name,
      flags: u16(bytes, at + 8),
      method: u16(bytes, at + 10),
      compressed: u32(bytes, at + 20),
      size: u32(bytes, at + 24),
      offset: u32(bytes, at + 42),
    };
    // ZIP64 sizes and offset live in the extra field (id 1) when the 32-bit fields are full.
    let x = at + 46 + nameLength;
    const xEnd = x + extraLength;
    while (x + 4 <= xEnd) {
      const id = u16(bytes, x);
      const len = u16(bytes, x + 2);
      if (id === 1) {
        let k = x + 4;
        const big = () => {
          const v = u32(bytes, k) + u32(bytes, k + 4) * 2 ** 32;
          k += 8;
          return v;
        };
        if (entry.size === 0xffffffff) entry.size = big();
        if (entry.compressed === 0xffffffff) entry.compressed = big();
        if (entry.offset === 0xffffffff) entry.offset = big();
      }
      x += 4 + len;
    }
    entries.set(name.toLowerCase(), entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  const names = [...entries.values()].map((e) => e.name);
  const entryOf = (/** @type {string} */ name) => {
    const entry = entries.get(name.replace(/^\//, "").toLowerCase());
    if (!entry) throw new Error(`no ${name} in the package`);
    return entry;
  };
  const read = async (/** @type {string} */ name) => {
    const entry = entryOf(name);
    if (entry.flags & 1) throw new Error(`${name} is encrypted`);
    const local = entry.offset;
    if (u32(bytes, local) !== 0x04034b50) throw new Error(`damaged ZIP entry ${name}`);
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + entry.compressed);
    if (data.length < entry.compressed) throw new Error(`${name} is cut short`);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflate(data, entry.size);
    throw new Error(`${name} uses compression method ${entry.method}`);
  };
  return {
    names,
    has: (name) => entries.has(name.replace(/^\//, "").toLowerCase()),
    encrypted: (name) => Boolean(entryOf(name).flags & 1),
    bytes: read,
    text: async (name) => utf8(await read(name)),
  };
}
