// Bytes: integers at an offset, the text encodings disks use, their dates, checksums and sizes as
// people read them. Pure functions over Uint8Array.

/** @param {Uint8Array} b @param {number} o */
export const u16 = (b, o) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
/** @param {Uint8Array} b @param {number} o */
export const u32 = (b, o) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
/** A little-endian 64-bit integer as a Number (exact below 2^53). @param {Uint8Array} b @param {number} o */
export const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
/** @param {Uint8Array} b @param {number} o */
export const u16be = (b, o) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
/** @param {Uint8Array} b @param {number} o */
export const u32be = (b, o) => ((u16be(b, o) << 16) | u16be(b, o + 2)) >>> 0;
/** @param {Uint8Array} b @param {number} o */
export const u64be = (b, o) => u32be(b, o) * 0x100000000 + u32be(b, o + 4);
/** A 64-bit field whole, for entries that keep flags in their top bits. @param {Uint8Array} b @param {number} o */
export const big64 = (b, o) => (BigInt(u32(b, o + 4)) << 32n) | BigInt(u32(b, o));
/** @param {Uint8Array} b @param {number} o */
export const big64be = (b, o) => (BigInt(u32be(b, o)) << 32n) | BigInt(u32be(b, o + 4));

/** Whether `b` holds `ascii` at `o`. @param {Uint8Array} b @param {number} o @param {string} ascii */
export function at(b, o, ascii) {
  if (o < 0 || o + ascii.length > b.length) return false;
  for (let i = 0; i < ascii.length; i++) if (b[o + i] !== ascii.charCodeAt(i)) return false;
  return true;
}

const decoders = new Map();
/** @param {string} label @param {boolean} [fatal] */
const decoder = (label, fatal = false) => {
  const id = `${label}:${fatal}`;
  if (!decoders.has(id)) decoders.set(id, new TextDecoder(label, { fatal }));
  return /** @type {TextDecoder} */ (decoders.get(id));
};
/** @param {Uint8Array} b */
export const utf16le = (b) => decoder("utf-16le").decode(b);
/** UTF-16 up to its first NUL. @param {Uint8Array} b */
export const utf16z = (b) => utf16le(b).replace(/\0[\s\S]*$/, "");
/** @param {Uint8Array} b */
export const latin1 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000)
    s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 0x2000)));
  return s;
};
/** UTF-8 when the bytes are valid UTF-8, otherwise Latin-1. @param {Uint8Array} b */
export const text = (b) => {
  try {
    return decoder("utf-8", true).decode(b);
  } catch {
    return latin1(b);
  }
};

/** A GUID as written in its mixed-endian bytes. @param {Uint8Array} b */
export function guid(b) {
  const h = (/** @type {number} */ i) => (b[i] ?? 0).toString(16).padStart(2, "0");
  const run = (/** @type {number[]} */ is) => is.map(h).join("");
  return [run([3, 2, 1, 0]), run([5, 4]), run([7, 6]), run([8, 9]), run([10, 11, 12, 13, 14, 15])]
    .join("-")
    .toUpperCase();
}

/** A DOS date and time (local time, two-second steps); undefined when unset. */
export function dosDate(/** @type {number} */ date, /** @type {number} */ time, centis = 0) {
  if (!date) return undefined;
  const d = new Date(
    1980 + (date >> 9),
    ((date >> 5) & 15) - 1,
    date & 31,
    time >> 11,
    (time >> 5) & 63,
    (time & 31) * 2,
    centis * 10,
  );
  return Number.isNaN(d.getTime()) ? undefined : d;
}
/** Seconds since 1970 (UTC). */
export const unixDate = (/** @type {number} */ seconds) =>
  Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
/** A Windows FILETIME: 100 ns steps since 1601 (UTC), as a little-endian field. @param {Uint8Array} b @param {number} o */
export function fileTime(b, o) {
  const value = u64(b, o);
  return value ? new Date(Math.round(value / 10000 - 11644473600000)) : undefined;
}

const UNITS = ["KiB", "MiB", "GiB", "TiB", "PiB"];
/** "17 bytes", "1.5 KiB", "64 MiB": one decimal below ten. */
export function formatSize(/** @type {number} */ n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} ${n === 1 ? "byte" : "bytes"}`;
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}
/** "64 MiB (67,108,864 bytes)", or just the bytes below 1 KiB. */
export const sizeDetail = (/** @type {number} */ n) =>
  n < 1024
    ? `${n.toLocaleString("en-US")} ${n === 1 ? "byte" : "bytes"}`
    : `${formatSize(n)} (${n.toLocaleString("en-US")} bytes)`;

/** @param {number} poly reflected polynomial */
const crcTable = (poly) =>
  Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? poly ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
const CRC32 = crcTable(0xedb88320);
const CRC32C = crcTable(0x82f63b78);
/** @param {Uint32Array} table @param {Uint8Array} bytes @param {number} seed */
function crc(table, bytes, seed) {
  let c = seed;
  for (let i = 0; i < bytes.length; i++) c = (table[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return c >>> 0;
}
/** CRC-32 (GPT). @param {Uint8Array} bytes */
export const crc32 = (bytes) => (crc(CRC32, bytes, 0xffffffff) ^ 0xffffffff) >>> 0;
/** CRC-32C (VHDX, ext4's metadata_csum), finished. @param {Uint8Array} bytes */
export const crc32c = (bytes) => (crc(CRC32C, bytes, 0xffffffff) ^ 0xffffffff) >>> 0;
/** CRC-32C without the final inversion, as ext4 stores it. @param {Uint8Array} bytes @param {number} [seed] */
export const crc32cRaw = (bytes, seed = 0xffffffff) => crc(CRC32C, bytes, seed);
