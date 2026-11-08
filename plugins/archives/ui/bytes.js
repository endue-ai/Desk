// Bytes: integers at an offset, text in the encodings archives use, dates in their epochs, base64,
// and sizes as the person reads them. Pure functions over Uint8Array; no DOM.

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

const decoders = new Map();
/** @param {string} label @param {boolean} [fatal] */
const decoder = (label, fatal = false) => {
  const id = `${label}:${fatal}`;
  if (!decoders.has(id)) decoders.set(id, new TextDecoder(label, { fatal }));
  return /** @type {TextDecoder} */ (decoders.get(id));
};
/** @param {Uint8Array} b */
export const utf8 = (b) => decoder("utf-8").decode(b);
/** @param {Uint8Array} b */
export const utf16le = (b) => decoder("utf-16le").decode(b);
/** @param {Uint8Array} b */
export const utf16be = (b) => decoder("utf-16be").decode(b);
/** @param {Uint8Array} b */
export const latin1 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000)
    s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 0x2000)));
  return s;
};
/** UTF-8 when the bytes are valid UTF-8, otherwise Latin-1: names from tools that never said. */
export const text = (/** @type {Uint8Array} */ b) => {
  try {
    return decoder("utf-8", true).decode(b);
  } catch {
    return latin1(b);
  }
};
/** A NUL-terminated name in a fixed field. @param {Uint8Array} b @param {number} o @param {number} n */
export const field = (b, o, n) => {
  const part = b.subarray(o, o + n);
  const end = part.indexOf(0);
  return text(end < 0 ? part : part.subarray(0, end));
};

// The upper half of code page 437, as DOS (and ZIP without the UTF-8 flag) wrote names.
const CP437 =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
  "áíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
/** @param {Uint8Array} b */
export const cp437 = (b) => {
  let s = "";
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : CP437.charAt(c - 0x80);
  return s;
};

/** A DOS date and time (local time, two-second steps); undefined when unset. */
export function dosDate(/** @type {number} */ date, /** @type {number} */ time) {
  if (!date) return undefined;
  const d = new Date(
    1980 + (date >> 9),
    ((date >> 5) & 15) - 1,
    date & 31,
    time >> 11,
    (time >> 5) & 63,
    (time & 31) * 2,
  );
  return Number.isNaN(d.getTime()) ? undefined : d;
}
/** Seconds since 1970 (UTC). */
export const unixDate = (/** @type {number} */ seconds) =>
  Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
/** A Windows FILETIME: 100 ns steps since 1601 (UTC), from its two halves. */
export function fileTime(/** @type {number} */ low, /** @type {number} */ high) {
  const ms = (high * 0x100000000 + low) / 10000 - 11644473600000;
  return high || low ? new Date(Math.round(ms)) : undefined;
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
/** "67,125,248 bytes". */
export const formatBytes = (/** @type {number} */ n) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? "byte" : "bytes"}`;

/** @param {Uint8Array} b */
export function toBase64(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @param {string} s */
export function fromBase64(s) {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** A cursor over a header: little-endian reads that move on. */
export class Cursor {
  /** @param {Uint8Array} bytes @param {number} [pos] */
  constructor(bytes, pos = 0) {
    this.b = bytes;
    this.pos = pos;
  }
  get left() {
    return this.b.length - this.pos;
  }
  /** @param {number} n */
  need(n) {
    if (this.pos + n > this.b.length) throw new Error("The header ends early.");
  }
  u8() {
    this.need(1);
    return /** @type {number} */ (this.b[this.pos++]);
  }
  u16() {
    this.need(2);
    this.pos += 2;
    return u16(this.b, this.pos - 2);
  }
  u32() {
    this.need(4);
    this.pos += 4;
    return u32(this.b, this.pos - 4);
  }
  u64() {
    this.need(8);
    this.pos += 8;
    return u64(this.b, this.pos - 8);
  }
  /** @param {number} n */
  bytes(n) {
    this.need(n);
    this.pos += n;
    return this.b.subarray(this.pos - n, this.pos);
  }
  /** @param {number} n */
  skip(n) {
    this.need(n);
    this.pos += n;
  }
}
