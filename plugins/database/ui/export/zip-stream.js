// A zip written as it goes (PG-64, a whole export's .xlsx): small files whole (as zip.js writes
// them), and one file streamed: its local header first, its bytes deflated as they come (deflate.js)
// with their CRC-32 counted on the way, then a data descriptor with the sizes; the central directory
// at the end. The same fixed time and UTF-8 names as zip.js. No ZIP64: past 4 GiB it refuses. No DOM.

import { t } from "../strings/index.js";
import { canCompress, deflater } from "./deflate.js";
import { crc32 } from "./zip.js";

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_NAMES = 0x0800;
const DESCRIPTOR = 0x0008;
const LIMIT = 0xffffffff;

/**
 * @typedef {{ name: Uint8Array, method: number, flags: number, crc: number, packed: number, size: number, offset: number }} Record
 */

/** A writer of one zip; every call answers the bytes to append to the file. */
export function zipStream() {
  const encoder = new TextEncoder();
  /** @type {Record[]} */
  const records = [];
  let offset = 0;
  const local = (/** @type {Omit<Record, "offset">} */ r) => {
    const out = new Uint8Array(30 + r.name.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, r.flags, true);
    v.setUint16(8, r.method, true);
    v.setUint16(12, DOS_DATE, true);
    v.setUint32(14, r.crc, true);
    v.setUint32(18, r.packed, true);
    v.setUint32(22, r.size, true);
    v.setUint16(26, r.name.length, true);
    out.set(r.name, 30);
    return out;
  };
  const grow = (/** @type {number} */ n) => {
    if (offset + n > LIMIT) throw new Error(t("export.zipStream.exportTheXlsxIsPastGib"));
    offset += n;
  };
  return {
    /** A small file, whole and stored. */
    file(/** @type {string} */ path, /** @type {Uint8Array} */ data) {
      const r = {
        name: encoder.encode(path),
        method: 0,
        flags: UTF8_NAMES,
        crc: crc32(data),
        packed: data.length,
        size: data.length,
      };
      records.push({ ...r, offset });
      const head = local(r);
      grow(head.length + data.length);
      return [head, data];
    },
    /** A file streamed: push its bytes, then close it. */
    open(/** @type {string} */ path) {
      const name = encoder.encode(path);
      const method = canCompress() ? 8 : 0;
      const flags = UTF8_NAMES | DESCRIPTOR;
      const start = offset;
      const head = local({ name, method, flags, crc: 0, packed: 0, size: 0 });
      grow(head.length);
      const packer = method === 8 ? deflater("deflate-raw") : undefined;
      let crc = 0;
      let size = 0;
      let packed = 0;
      const out = (/** @type {Uint8Array[]} */ parts) => {
        for (const p of parts) {
          packed += p.length;
          grow(p.length);
        }
        return parts;
      };
      let first = true;
      return {
        async push(/** @type {Uint8Array} */ bytes) {
          crc = crc32(bytes, crc);
          size += bytes.length;
          const parts = out(packer ? await packer.push(bytes) : [bytes]);
          if (!first) return parts;
          first = false;
          return [head, ...parts];
        },
        async close() {
          const parts = out(packer ? await packer.end() : []);
          if (size > LIMIT) throw new Error(t("export.zipStream.exportTheXlsxIsPastGib"));
          const tail = new Uint8Array(16);
          const v = new DataView(tail.buffer);
          v.setUint32(0, 0x08074b50, true);
          v.setUint32(4, crc, true);
          v.setUint32(8, packed, true);
          v.setUint32(12, size, true);
          grow(16);
          records.push({ name, method, flags, crc, packed, size, offset: start });
          return [...(first ? [head] : []), ...parts, tail];
        },
      };
    },
    /** The central directory and its end. */
    end() {
      const at = offset;
      const parts = records.map((r) => {
        const out = new Uint8Array(46 + r.name.length);
        const v = new DataView(out.buffer);
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(8, r.flags, true);
        v.setUint16(10, r.method, true);
        v.setUint16(14, DOS_DATE, true);
        v.setUint32(16, r.crc, true);
        v.setUint32(20, r.packed, true);
        v.setUint32(24, r.size, true);
        v.setUint16(28, r.name.length, true);
        v.setUint32(42, r.offset, true);
        out.set(r.name, 46);
        return out;
      });
      const size = parts.reduce((n, p) => n + p.length, 0);
      const end = new Uint8Array(22);
      const e = new DataView(end.buffer);
      e.setUint32(0, 0x06054b50, true);
      e.setUint16(8, records.length, true);
      e.setUint16(10, records.length, true);
      e.setUint32(12, size, true);
      e.setUint32(16, at, true);
      return [...parts, end];
    },
  };
}
