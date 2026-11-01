// Bytes for the readers: a cursor over a Uint8Array in either byte order, text in the encodings media
// tags use, and base64 both ways. No DOM, so the readers run anywhere.

/** A cursor over bytes. Reads past the end return zeros, so a short file is a damaged one, not a crash. */
export class Cursor {
  /**
   * @param {Uint8Array} bytes
   * @param {number} [pos]
   * @param {boolean} [little] little-endian numbers
   */
  constructor(bytes, pos = 0, little = false) {
    this.bytes = bytes;
    this.pos = pos;
    this.little = little;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get left() {
    return Math.max(0, this.bytes.length - this.pos);
  }
  /** @param {number} n */
  has(n) {
    return this.pos + n <= this.bytes.length;
  }
  /** @param {number} n */
  skip(n) {
    this.pos += n;
    return this;
  }
  /**
   * @param {number} n
   * @param {(view: DataView, at: number) => number} get
   */
  #num(n, get) {
    const at = this.pos;
    this.pos += n;
    return at + n <= this.bytes.length ? get(this.view, at) : 0;
  }
  u8() {
    return this.#num(1, (v, at) => v.getUint8(at));
  }
  u16() {
    return this.#num(2, (v, at) => v.getUint16(at, this.little));
  }
  i16() {
    return this.#num(2, (v, at) => v.getInt16(at, this.little));
  }
  u24() {
    const [a = 0, b = 0, c = 0] = this.take(3);
    return this.little ? a | (b << 8) | (c << 16) : (a << 16) | (b << 8) | c;
  }
  u32() {
    return this.#num(4, (v, at) => v.getUint32(at, this.little));
  }
  i32() {
    return this.#num(4, (v, at) => v.getInt32(at, this.little));
  }
  /** 64 bits as a Number: exact up to 2^53, enough for sizes and durations. */
  u64() {
    const a = this.u32();
    const b = this.u32();
    return this.little ? b * 2 ** 32 + a : a * 2 ** 32 + b;
  }
  f32() {
    return this.#num(4, (v, at) => v.getFloat32(at, this.little));
  }
  f64() {
    return this.#num(8, (v, at) => v.getFloat64(at, this.little));
  }
  /** @param {number} n */
  take(n) {
    const part = this.bytes.subarray(this.pos, Math.min(this.bytes.length, this.pos + n));
    this.pos += n;
    return part;
  }
  /** @param {number} n */
  ascii(n) {
    return ascii(this.take(n));
  }
}

/** @param {Uint8Array} bytes */
export const ascii = (bytes) => String.fromCharCode(...bytes);

/** Latin-1, which is what "no encoding said" means in ID3, RIFF and AIFF. */
export const latin1 = (/** @type {Uint8Array} */ bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x4000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return text;
};

/** @param {Uint8Array} bytes */
export const utf8 = (bytes) => new TextDecoder("utf-8").decode(bytes);

/** UTF-8 when the bytes are UTF-8, else Latin-1 (RIFF INFO and old tags are either). */
export const utf8OrLatin1 = (/** @type {Uint8Array} */ bytes) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return latin1(bytes);
  }
};

/**
 * UTF-16 with or without a byte order mark; without one, `little` decides.
 * @param {Uint8Array} bytes
 * @param {boolean} [little]
 */
export const utf16 = (bytes, little = true) => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes.subarray(2), true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes.subarray(2), false);
  return new TextDecoder(little ? "utf-16le" : "utf-16be").decode(bytes);
};

/** Text up to the first NUL, and what is left of a string field. */
export const trimNul = (/** @type {string} */ text) => {
  const nul = text.indexOf("\0");
  return (nul < 0 ? text : text.slice(0, nul)).trim();
};

/** @param {string} text */
export function fromBase64(text) {
  const binary = atob(text.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  return btoa(latin1(bytes));
}

/** Whether `bytes` holds `text` (ASCII) at `at`. */
export const startsWith = (/** @type {Uint8Array} */ bytes, /** @type {string} */ text, at = 0) => {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** The first index of `text` (ASCII) in `bytes` from `from`, or -1. */
export function indexOf(/** @type {Uint8Array} */ bytes, /** @type {string} */ text, from = 0) {
  const first = text.charCodeAt(0);
  for (let i = bytes.indexOf(first, from); i >= 0; i = bytes.indexOf(first, i + 1)) {
    if (i + text.length > bytes.length) return -1;
    if (startsWith(bytes, text, i)) return i;
  }
  return -1;
}

/** An image's media type from its first bytes; the tag's own word otherwise. */
export function imageType(/** @type {Uint8Array} */ bytes, fallback = "image/jpeg") {
  if (bytes[0] === 0x89 && startsWith(bytes, "PNG", 1)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (startsWith(bytes, "GIF8")) return "image/gif";
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8)) return "image/webp";
  if (startsWith(bytes, "BM")) return "image/bmp";
  return fallback;
}
