// PalmDB containers (MOBI, AZW, AZW3, PRC) and their text compressions: PalmDOC's LZ77 and
// MOBI's HUFF/CDIC, and the trailing entries MOBI appends to every text record.
import { ascii, u16, u32 } from "./bytes.js";
import { Unreadable } from "./errors.js";

/** @typedef {{ name: string, type: string, creator: string, records: Uint8Array[] }} Pdb */

/** @param {Uint8Array} bytes @returns {Pdb} */
export function readPdb(bytes) {
  if (bytes.length < 78) throw new Unreadable("The book is damaged: it is too short.");
  const count = u16(bytes, 76);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(u32(bytes, 78 + i * 8));
  if (offsets.some((o, i) => o > bytes.length || (i > 0 && o < (offsets[i - 1] ?? 0))))
    throw new Unreadable("The book is damaged: its record list is out of order.");
  const records = offsets.map((start, i) => bytes.subarray(start, offsets[i + 1] ?? bytes.length));
  const name = ascii(bytes, 0, 32).split("\0")[0] ?? "";
  return { name, type: ascii(bytes, 60, 4), creator: ascii(bytes, 64, 4), records };
}

/** PalmDOC decompression: literals, runs of 1-8 literal bytes, space pairs and back-references. */
export function palmdoc(/** @type {Uint8Array} */ data) {
  const out = new Uint8Array(Math.max(4096, data.length * 8));
  let o = 0;
  for (let i = 0; i < data.length; ) {
    const c = data[i++] ?? 0;
    if (c >= 1 && c <= 8) {
      out.set(data.subarray(i, i + c), o);
      o += c;
      i += c;
    } else if (c <= 0x7f) out[o++] = c;
    else if (c >= 0xc0) {
      out[o++] = 0x20;
      out[o++] = c ^ 0x80;
    } else {
      const pair = (c << 8) | (data[i++] ?? 0);
      const distance = (pair >> 3) & 0x7ff;
      const length = (pair & 7) + 3;
      for (let n = 0; n < length; n++, o++)
        out[o] = distance > 0 && o >= distance ? (out[o - distance] ?? 0) : 0;
    }
    if (o > out.length - 16)
      throw new Unreadable("The book is damaged: a text record decompresses too far.");
  }
  return out.slice(0, o);
}

/** HUFF/CDIC: the first record holds the code tables, the others the phrase dictionary. */
export function huffcdic(/** @type {Uint8Array[]} */ records) {
  const [huff, ...cdics] = records;
  if (!huff || ascii(huff, 0, 4) !== "HUFF")
    throw new Unreadable("The book's HUFF table is damaged.");
  const table1 = u32(huff, 8);
  const table2 = u32(huff, 12);
  /** @type {Array<[number, boolean, number]>} */
  const dict1 = [];
  for (let i = 0; i < 256; i++) {
    const v = u32(huff, table1 + i * 4);
    const length = v & 0x1f;
    dict1.push([length, (v & 0x80) !== 0, ((v >>> 8) + 1) * 2 ** (32 - length) - 1]);
  }
  const min = [0];
  const max = [0];
  for (let length = 1; length <= 32; length++) {
    min.push(u32(huff, table2 + (length - 1) * 8) * 2 ** (32 - length));
    max.push((u32(huff, table2 + (length - 1) * 8 + 4) + 1) * 2 ** (32 - length) - 1);
  }
  /** @type {Array<{ bytes: Uint8Array, done: boolean } | null>} */
  const phrases = [];
  for (const cdic of cdics) {
    if (ascii(cdic, 0, 4) !== "CDIC")
      throw new Unreadable("The book's CDIC dictionary is damaged.");
    const total = u32(cdic, 8);
    const bits = u32(cdic, 12);
    const n = Math.min(2 ** bits, total - phrases.length);
    for (let i = 0; i < n; i++) {
      const at = 16 + u16(cdic, 16 + i * 2);
      const head = u16(cdic, at);
      phrases.push({
        bytes: cdic.subarray(at + 2, at + 2 + (head & 0x7fff)),
        done: (head & 0x8000) !== 0,
      });
    }
  }
  /** @param {Uint8Array} data @returns {Uint8Array} */
  const unpack = (data) => {
    const parts = [];
    let size = 0;
    const bits = data.length * 8;
    /** 32 bits from bit `at`, zeros past the end. */
    const peek = (/** @type {number} */ at) => {
      const byte = at >> 3;
      let v = 0;
      for (let k = 0; k < 5; k++) v = v * 256 + (data[byte + k] ?? 0);
      return Math.floor(v / 2 ** (8 - (at & 7))) % 2 ** 32;
    };
    for (let at = 0; ; ) {
      const code = peek(at);
      let [length, term, maxcode] = dict1[Math.floor(code / 2 ** 24)] ?? [0, true, 0];
      if (length === 0) throw new Unreadable("The book's HUFF table is damaged.");
      if (!term) {
        while (code < (min[length] ?? 0)) length++;
        maxcode = max[length] ?? 0;
      }
      at += length;
      if (at > bits) break;
      const index = Math.floor((maxcode - code) / 2 ** (32 - length));
      const phrase = phrases[index];
      if (!phrase) throw new Unreadable("The book's CDIC dictionary is damaged.");
      if (!phrase.done) {
        phrases[index] = null;
        phrase.bytes = unpack(phrase.bytes);
        phrase.done = true;
        phrases[index] = phrase;
      }
      parts.push(phrase.bytes);
      size += phrase.bytes.length;
    }
    const out = new Uint8Array(size);
    let o = 0;
    for (const part of parts) {
      out.set(part, o);
      o += part.length;
    }
    return out;
  };
  return unpack;
}

/** How many bytes at the end of a text record are trailing entries, by the header's extra flags. */
export function trailing(/** @type {Uint8Array} */ record, /** @type {number} */ flags) {
  let size = 0;
  for (let f = flags >> 1; f; f >>= 1) {
    if (!(f & 1)) continue;
    let value = 0;
    for (let shift = 0, end = record.length - size; end > 0 && shift < 28; shift += 7) {
      const byte = record[--end] ?? 0;
      value |= (byte & 0x7f) << shift;
      if (byte & 0x80) break;
    }
    size += value;
  }
  if (flags & 1) size += ((record[record.length - size - 1] ?? 0) & 0x3) + 1;
  return Math.min(size, record.length);
}
