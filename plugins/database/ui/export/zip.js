// A zip archive of a few files (PG-61, the .xlsx package): each file deflated by the platform's
// CompressionStream when it has one and that is smaller, else stored, with its CRC-32, UTF-8 names
// and a fixed time (1980-01-01), so the same files always make the same bytes. No ZIP64: past 4 GiB
// it refuses. No DOM.

/** @typedef {{ name: string, data: Uint8Array }} ZipEntry */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of bytes, as zip records it. */
export function crc32(/** @type {Uint8Array} */ data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    crc = (CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Raw deflate through the platform, or undefined where it has none. */
async function deflated(/** @type {Uint8Array} */ data) {
  if (typeof CompressionStream === "undefined") return undefined;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream("deflate-raw")).getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    chunks.push(next.value);
    size += next.value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_NAMES = 0x0800;

/**
 * @param {ZipEntry[]} entries
 * @param {{ deflate?: boolean }} [options] `deflate: false` stores every file.
 */
export async function zip(entries, { deflate = true } = {}) {
  const encoder = new TextEncoder();
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const packed = deflate ? await deflated(entry.data) : undefined;
    const method = packed && packed.length < entry.data.length ? 8 : 0;
    const body = method === 8 && packed ? packed : entry.data;
    if (offset + body.length > 0xffffffff) throw new Error("Export: the .xlsx is past 4 GiB.");
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, UTF8_NAMES, true);
    l.setUint16(8, method, true);
    l.setUint16(10, 0, true);
    l.setUint16(12, DOS_DATE, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, body.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8_NAMES, true);
    c.setUint16(10, method, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    record.set(name, 46);
    parts.push(local, body);
    central.push(record);
    offset += local.length + body.length;
  }
  const size = central.reduce((n, r) => n + r.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
