// Test encoders for the SquashFS writer: LZO1X (every instruction form, from the stream format),
// bare LZ4 blocks, xz streams of stored LZMA2 chunks, Zstandard (the platform's when it has one,
// raw-block frames when not) and zlib. Plain greedy matching; correctness, not ratio.
import * as zlib from "node:zlib";

/** The ids and encoders of the compressors SquashFS 4.0 names. */
export const COMPRESSORS = {
  gzip: { id: 1, encode: (b: Uint8Array) => new Uint8Array(zlib.deflateSync(b, { level: 9 })) },
  lzo: { id: 3, encode: (b: Uint8Array) => lzo1x(b) },
  xz: { id: 4, encode: (b: Uint8Array) => xzStored(b) },
  lz4: { id: 5, encode: (b: Uint8Array) => lz4Block(b) },
  zstd: { id: 6, encode: (b: Uint8Array) => zstd(b) },
} as const;
export type Compressor = keyof typeof COMPRESSORS;

const u32 = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
const hash4 = (b: Uint8Array, o: number) => (Math.imul(u32(b, o), 2654435761) >>> 18) & 0x3fff;
/** How many bytes from `a` and `b` agree, up to `max`. */
function agree(src: Uint8Array, a: number, b: number, max: number) {
  let n = 0;
  while (n < max && src[a + n] === src[b + n]) n++;
  return n;
}

/** An LZ4 block (no frame): literal runs and matches into the last 64 KiB. */
export function lz4Block(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const table = new Int32Array(1 << 14).fill(-1);
  const extend = (n: number) => {
    for (; n >= 255; n -= 255) out.push(255);
    out.push(n);
  };
  const sequence = (from: number, to: number, offset: number, length: number) => {
    const lit = to - from;
    out.push((Math.min(lit, 15) << 4) | (length ? Math.min(length - 4, 15) : 0));
    if (lit >= 15) extend(lit - 15);
    for (let i = from; i < to; i++) out.push(src[i] ?? 0);
    if (!length) return;
    out.push(offset & 255, offset >> 8);
    if (length - 4 >= 15) extend(length - 4 - 15);
  };
  let anchor = 0;
  for (let i = 0; i + 12 < src.length; ) {
    const h = hash4(src, i);
    const candidate = table[h] ?? -1;
    table[h] = i;
    if (candidate >= 0 && i - candidate <= 65535 && u32(src, candidate) === u32(src, i)) {
      const length = 4 + agree(src, candidate + 4, i + 4, src.length - 5 - (i + 4));
      sequence(anchor, i, i - candidate, length);
      i += length;
      anchor = i;
    } else i++;
  }
  sequence(anchor, src.length, 0, 0);
  return Uint8Array.from(out);
}

/**
 * LZO1X: literal runs in the first-byte form, short (1-3, in the match's low bits) and long forms;
 * matches as M1 (2 bytes after 1-3 literals, 3 bytes at 2-3 KiB after a long run), M2, M3 and M4.
 */
export function lzo1x(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const n = src.length;
  const table = new Int32Array(1 << 14).fill(-1);
  let state = 0; // literals the last instruction copied, 4 for a long run
  let tailAt = -1; // the byte whose low 2 bits say how many literals follow the last match
  const extend = (v: number) => {
    for (; v > 255; v -= 255) out.push(0);
    out.push(v);
  };
  const literals = (from: number, to: number) => {
    const count = to - from;
    if (count === 0) {
      state = 0;
      return;
    }
    if (tailAt < 0 && out.length === 0 && count <= 238) out.push(17 + count);
    else if (count <= 3 && tailAt >= 0) out[tailAt] = (out[tailAt] ?? 0) | count;
    else if (count - 3 <= 15) out.push(count - 3);
    else {
      out.push(0);
      extend(count - 3 - 15);
    }
    for (let i = from; i < to; i++) out.push(src[i] ?? 0);
    state = Math.min(count, 4);
  };
  const match = (distance: number, length: number) => {
    if (length === 2) {
      const d = distance - 1;
      out.push((d & 3) << 2, d >> 2);
      tailAt = out.length - 2;
    } else if (length === 3 && state === 4 && distance >= 2049 && distance <= 3072) {
      const d = distance - 2049;
      out.push((d & 3) << 2, d >> 2);
      tailAt = out.length - 2;
    } else if (length <= 8 && distance <= 2048) {
      const d = distance - 1;
      out.push(((length - 1) << 5) | ((d & 7) << 2), d >> 3);
      tailAt = out.length - 2;
    } else if (distance <= 16384) {
      if (length - 2 <= 31) out.push(32 | (length - 2));
      else {
        out.push(32);
        extend(length - 2 - 31);
      }
      const d = distance - 1;
      out.push((d & 0x3f) << 2, d >> 6);
      tailAt = out.length - 2;
    } else {
      const d = distance - 16384;
      const high = (d >> 14) << 3;
      if (length - 2 <= 7) out.push(16 | high | (length - 2));
      else {
        out.push(16 | high);
        extend(length - 2 - 7);
      }
      const low = d & 0x3fff;
      out.push((low & 0x3f) << 2, low >> 6);
      tailAt = out.length - 2;
    }
    state = 0;
  };
  /** A 2-byte match within 1 KiB, for M1 right after one to three literals. */
  const near = (i: number) => {
    for (let d = 1; d <= Math.min(1024, i); d++)
      if (src[i - d] === src[i] && src[i - d + 1] === src[i + 1]) return d;
    return 0;
  };
  let anchor = 0;
  for (let i = 0; i + 4 <= n; ) {
    const h = hash4(src, i);
    const candidate = table[h] ?? -1;
    table[h] = i;
    let distance = i - candidate;
    let length = candidate >= 0 && distance <= 49151 ? agree(src, candidate, i, n - i) : 0;
    const pending = i - anchor;
    if (length < 3) {
      length = 0;
      if (pending > 0 && pending < 4 && (tailAt >= 0 || anchor === 0)) {
        distance = near(i);
        if (distance) length = 2;
      }
    }
    if (length) {
      literals(anchor, i);
      match(distance, length);
      i += length;
      anchor = i;
    } else i++;
  }
  literals(anchor, n);
  out.push(0x11, 0, 0);
  return Uint8Array.from(out);
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const le32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
const varint = (v: number) => {
  const out = [];
  for (; v >= 0x80; v = Math.floor(v / 128)) out.push((v & 0x7f) | 0x80);
  out.push(v);
  return out;
};
const withCrc = (bytes: number[]) => [...bytes, ...le32(crc32(Uint8Array.from(bytes)))];

/** An xz stream (CRC32 check) whose one block holds LZMA2 chunks stored as they are. */
export function xzStored(src: Uint8Array): Uint8Array {
  const flags = [0, 1];
  const stream = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0, ...withCrc(flags)];
  const block = withCrc([2, 0, 0x21, 1, 16, 0, 0, 0]);
  const data: number[] = [];
  for (let o = 0; o < src.length; o += 65536) {
    const chunk = src.subarray(o, Math.min(src.length, o + 65536));
    data.push(o === 0 ? 1 : 2, (chunk.length - 1) >> 8, (chunk.length - 1) & 255, ...chunk);
  }
  data.push(0);
  const pad = (4 - (data.length % 4)) % 4;
  const unpadded = block.length + data.length + 4;
  const index = [0, ...varint(1), ...varint(unpadded), ...varint(src.length)];
  while (index.length % 4) index.push(0);
  const indexed = withCrc(index);
  const backward = indexed.length / 4 - 1;
  const footer = withCrc([...le32(backward), ...flags]);
  const footerBytes = [...footer.slice(-4), ...footer.slice(0, -4), 0x59, 0x5a]; // CRC first
  return Uint8Array.from([
    ...stream,
    ...block,
    ...data,
    ...new Array(pad).fill(0),
    ...le32(crc32(src)),
    ...indexed,
    ...footerBytes,
  ]);
}

/** A Zstandard frame: the platform's encoder when Node has one, raw blocks otherwise. */
export function zstd(src: Uint8Array): Uint8Array {
  const native = (zlib as { zstdCompressSync?: (b: Uint8Array) => Buffer }).zstdCompressSync;
  if (native) return new Uint8Array(native(src));
  const out = [0x28, 0xb5, 0x2f, 0xfd, 0xa0, ...le32(src.length)];
  let o = 0;
  do {
    const n = Math.min(src.length - o, 131072);
    const last = o + n >= src.length ? 1 : 0;
    const head = (n << 3) | last;
    out.push(head & 255, (head >> 8) & 255, head >> 16, ...src.subarray(o, o + n));
    o += n;
  } while (o < src.length);
  return Uint8Array.from(out);
}
