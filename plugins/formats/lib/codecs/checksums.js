// CRC-32 (IEEE, as ZIP, gzip, xz, 7z and LZ4's frame header use it), updated chunk by chunk.

const TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c;
}

/** The CRC-32 of `bytes`, continuing from `crc` (the value so far, 0 to start). */
export function crc32(/** @type {Uint8Array} */ bytes, crc = 0) {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++)
    c = /** @type {number} */ (TABLE[(c ^ /** @type {number} */ (bytes[i])) & 0xff]) ^ (c >>> 8);
  return ~c >>> 0;
}

/** bzip2's CRC: the same polynomial, most significant bit first. */
const BZ = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  BZ[n] = c;
}
/** @param {Uint8Array} bytes @param {number} length @param {number} crc the value so far (~0 to start) */
export function crcBzip2(bytes, length, crc) {
  let c = crc;
  for (let i = 0; i < length; i++)
    c =
      (c << 8) ^ /** @type {number} */ (BZ[((c >>> 24) ^ /** @type {number} */ (bytes[i])) & 0xff]);
  return c;
}
