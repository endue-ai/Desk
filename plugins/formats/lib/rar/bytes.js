// Bytes in RAR headers: little-endian integers, RAR 5's variable-length integers, names in UTF-8,
// in the OEM code page DOS and Windows hosts wrote, or in RAR 3's packed Unicode form, and dates.

/** @param {Uint8Array} b @param {number} o */
export const u16 = (b, o) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
/** @param {Uint8Array} b @param {number} o */
export const u32 = (b, o) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

export const DAMAGED_HEADER = "A RAR header is damaged.";

/** A cursor over a header: RAR 5's vints and fixed-size fields. */
export class Fields {
  /** @param {Uint8Array} bytes @param {number} pos @param {number} [end] */
  constructor(bytes, pos, end = bytes.length) {
    this.bytes = bytes;
    this.pos = pos;
    this.end = end;
  }
  /** A vint: seven bits per byte, low first, the high bit saying another byte follows. */
  vint() {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error(DAMAGED_HEADER);
      const c = /** @type {number} */ (this.bytes[this.pos++]);
      value += (c & 0x7f) * scale;
      scale *= 128;
      if (!(c & 0x80)) return value;
    }
    throw new Error(DAMAGED_HEADER);
  }
  u32() {
    if (this.pos + 4 > this.end) throw new Error(DAMAGED_HEADER);
    this.pos += 4;
    return u32(this.bytes, this.pos - 4);
  }
  /** @param {number} length */
  take(length) {
    if (length < 0 || this.pos + length > this.end) throw new Error(DAMAGED_HEADER);
    this.pos += length;
    return this.bytes.subarray(this.pos - length, this.pos);
  }
}

const strict = new TextDecoder("utf-8", { fatal: true });
const loose = new TextDecoder("utf-8");
/** @param {Uint8Array} b */
export const utf8 = (b) => loose.decode(b);

// Code page 437, the OEM code page of DOS and of Windows in most of the world: its upper half.
const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/**
 * A name RAR 4 stored as plain bytes: UTF-8 when the bytes are valid UTF-8 (Unix hosts), otherwise
 * the OEM code page for DOS and Windows hosts (0 and 2) and Latin-1 for the rest.
 * @param {Uint8Array} b @param {number} host
 */
export function plainName(b, host) {
  try {
    return strict.decode(b);
  } catch {
    let s = "";
    for (const c of b)
      s +=
        c < 0x80
          ? String.fromCharCode(c)
          : host === 0 || host === 2
            ? CP437[c - 0x80]
            : String.fromCharCode(c);
    return s;
  }
}

/**
 * RAR 3's Unicode names: the OEM name, a zero byte, then the wide name packed against it (a high
 * byte, then two flag bits per character). A field with no zero holds UTF-8.
 * @param {Uint8Array} field @param {number} host
 */
export function unicodeName(field, host) {
  const zero = field.indexOf(0);
  if (zero < 0) return utf8(field);
  const ascii = field.subarray(0, zero);
  const packed = field.subarray(zero + 1);
  /** @type {number[]} */
  const out = [];
  let pos = 0;
  const high = packed[pos++] ?? 0;
  let flags = 0;
  let bits = 0;
  while (pos < packed.length) {
    if (bits === 0) {
      flags = packed[pos++] ?? 0;
      bits = 8;
    }
    bits -= 2;
    const kind = (flags >> bits) & 3;
    if (kind === 0) out.push(packed[pos++] ?? 0);
    else if (kind === 1) out.push((packed[pos++] ?? 0) | (high << 8));
    else if (kind === 2) {
      out.push((packed[pos] ?? 0) | ((packed[pos + 1] ?? 0) << 8));
      pos += 2;
    } else {
      const length = packed[pos++] ?? 0;
      const extra = length & 0x80 ? (packed[pos++] ?? 0) : -1;
      for (let n = (length & 0x7f) + 2; n > 0 && out.length < ascii.length; n--) {
        const c = ascii[out.length] ?? 0;
        out.push(extra < 0 ? c : ((c + extra) & 0xff) | (high << 8));
      }
    }
  }
  const name = String.fromCharCode(...out);
  return name || plainName(ascii, host);
}

/** A DOS date and time (local time, two-second steps) as a Date, or undefined when unset. @param {number} stamp */
export function dosDate(stamp) {
  const date = stamp >>> 16;
  const time = stamp & 0xffff;
  if (date === 0) return undefined;
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

/** Seconds since 1970 as a Date. @param {number} seconds */
export const unixDate = (seconds) => new Date(seconds * 1000);

/** A Windows FILETIME (100 ns since 1601) from its two halves. @param {number} low @param {number} high */
export const fileTime = (low, high) =>
  new Date(Math.round((high * 0x100000000 + low) / 10000 - 11644473600000));
