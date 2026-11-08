// A small ZIP writer for test fixtures: stored or deflated entries, the central directory and its end
// record, CRC-32 included. Encrypted entries only set the flag; their data is not encrypted.
import { deflateRawSync } from "node:zlib";

export type Entry =
  | string
  | Uint8Array
  | { data: string | Uint8Array; stored?: boolean; encrypted?: boolean };

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encode = (data: string | Uint8Array) =>
  typeof data === "string" ? new TextEncoder().encode(data) : data;

/** A ZIP of the named entries, in order. Entries are deflated unless `stored` (or `mimetype`). */
export function zip(entries: Record<string, Entry>): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (out: number[], v: number) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (out: number[], v: number) => {
    u16(out, v & 0xffff);
    u16(out, (v >>> 16) & 0xffff);
  };
  let count = 0;
  for (const [name, entry] of Object.entries(entries)) {
    const spec = typeof entry === "string" || entry instanceof Uint8Array ? { data: entry } : entry;
    const raw = encode(spec.data);
    const stored = spec.stored ?? name === "mimetype";
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const nameBytes = new TextEncoder().encode(name);
    const flags = 0x0800 | (spec.encrypted ? 1 : 0);
    const offset = local.length;
    const header = (out: number[], central: boolean) => {
      u32(out, central ? 0x02014b50 : 0x04034b50);
      if (central) u16(out, 20);
      u16(out, 20);
      u16(out, flags);
      u16(out, stored ? 0 : 8);
      u32(out, 0);
      u32(out, crc32(raw));
      u32(out, data.length);
      u32(out, raw.length);
      u16(out, nameBytes.length);
      u16(out, 0);
      if (central) {
        u16(out, 0);
        u16(out, 0);
        u16(out, 0);
        u32(out, 0);
        u32(out, offset);
      }
      out.push(...nameBytes);
    };
    header(local, false);
    for (const b of data) local.push(b);
    header(central, true);
    count++;
  }
  const end: number[] = [];
  u32(end, 0x06054b50);
  u16(end, 0);
  u16(end, 0);
  u16(end, count);
  u16(end, count);
  u32(end, central.length);
  u32(end, local.length);
  u16(end, 0);
  return new Uint8Array([...local, ...central, ...end]);
}
