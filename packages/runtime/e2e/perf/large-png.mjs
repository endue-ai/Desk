// A large PNG made on the fixture server for the frame-time checks (#38): noise in RGBA, stored
// without compression, so its file is about as big as its pixels. Deterministic, made once.
import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Uint8Array} data */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A `side`×`side` RGBA PNG of noise: 1360 makes 7.1 MiB, under Explorer's 8 MiB preview limit. */
export function largePng(side = 1360) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(side * (side * 4 + 1));
  let seed = 0x2545f491;
  for (let y = 0; y < side; y++) {
    const row = y * (side * 4 + 1);
    raw[row] = 0;
    for (let i = 1; i <= side * 4; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      raw[row + i] = i % 4 === 0 ? 255 : seed >>> 24;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", new Uint8Array()),
  ]);
}
