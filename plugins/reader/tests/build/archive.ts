// ZIP and tar writers for the fixtures: just enough of each format for the reader's own parsers,
// with deflate from node:zlib so the reader's DecompressionStream path is exercised too.
import { crc32, deflateRawSync } from "node:zlib";

export type Entry = [name: string, data: Uint8Array | string, options?: { store?: boolean }];

const bytesOf = (data: Uint8Array | string) =>
  typeof data === "string" ? new TextEncoder().encode(data) : data;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A ZIP archive: each entry deflated unless `store` (an EPUB's mimetype is stored, first). */
export function zip(entries: Entry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data, options] of entries) {
    const raw = bytesOf(data);
    const store = options?.store ?? false;
    const body = store ? raw : new Uint8Array(deflateRawSync(raw));
    const fileName = new TextEncoder().encode(name);
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, store ? 0 : 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, fileName.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, store ? 0 : 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, fileName.length, true);
    central.setUint32(42, offset, true);
    const localBytes = concat([new Uint8Array(local.buffer), fileName, body]);
    locals.push(localBytes);
    centrals.push(concat([new Uint8Array(central.buffer), fileName]));
    offset += localBytes.length;
  }
  const directory = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, directory, new Uint8Array(end.buffer)]);
}

/** A POSIX (ustar) tar archive of regular files. */
export function tar(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, data] of entries) {
    const body = bytesOf(data);
    const header = new Uint8Array(512);
    const put = (at: number, text: string) => header.set(new TextEncoder().encode(text), at);
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${body.length.toString(8).padStart(11, "0")}\0`);
    put(136, "00000000000\0");
    put(156, "0");
    put(257, "ustar\0");
    put(263, "00");
    header.fill(0x20, 148, 156);
    const sum = header.reduce((n, b) => n + b, 0);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    parts.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  return concat(parts);
}

export { bytesOf, concat };
