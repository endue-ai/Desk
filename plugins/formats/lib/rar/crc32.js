// CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320): what both RAR formats store for headers and
// data. Eight tables (slicing by 8) keep it fast enough to check hundreds of megabytes.

const TABLES = (() => {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++)
    for (let k = 1; k < 8; k++) {
      const prev = /** @type {number} */ (t[(k - 1) * 256 + n]);
      t[k * 256 + n] = /** @type {number} */ (t[prev & 0xff] ^ (prev >>> 8)) >>> 0;
    }
  return t;
})();

/**
 * The CRC-32 of `bytes`, continuing from `crc` (the CRC of what came before, 0 at the start).
 * @param {Uint8Array} bytes @param {number} [crc]
 */
export function crc32(bytes, crc = 0) {
  const t = TABLES;
  let c = ~crc;
  let i = 0;
  const n = bytes.length;
  for (; i + 8 <= n; i += 8) {
    const a =
      (c ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24))) | 0;
    const b = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
    c =
      t[0x700 + (a & 0xff)] ^
      t[0x600 + ((a >>> 8) & 0xff)] ^
      t[0x500 + ((a >>> 16) & 0xff)] ^
      t[0x400 + (a >>> 24)] ^
      t[0x300 + (b & 0xff)] ^
      t[0x200 + ((b >>> 8) & 0xff)] ^
      t[0x100 + ((b >>> 16) & 0xff)] ^
      t[b >>> 24];
  }
  for (; i < n; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
