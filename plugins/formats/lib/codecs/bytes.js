// Bytes: little-endian integers at an offset, a signature check and joining parts. Pure functions over
// Uint8Array, shared by the decoders and the readers built on them.

/** @param {Uint8Array} b @param {number} o */
export const u16 = (b, o) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
/** @param {Uint8Array} b @param {number} o */
export const u32 = (b, o) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
/** A little-endian 64-bit integer as a Number (exact below 2^53). @param {Uint8Array} b @param {number} o */
export const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;

/** Whether `b` holds `ascii` at `o`. @param {Uint8Array} b @param {number} o @param {string} ascii */
export function at(b, o, ascii) {
  if (o < 0 || o + ascii.length > b.length) return false;
  for (let i = 0; i < ascii.length; i++) if (b[o + i] !== ascii.charCodeAt(i)) return false;
  return true;
}

/** @param {Uint8Array[]} parts */
export function concat(parts) {
  if (parts.length === 1 && parts[0]) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
