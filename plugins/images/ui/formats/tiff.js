// TIFF image file directories, for EXIF, camera RAW previews and the TIFF probe. Any two-byte
// magic after the byte order is accepted, so Panasonic's RW2 ("IIU") and Olympus's ORF ("IIRO") read
// too. Offsets are relative to the TIFF header at `base`; nothing is read past the end, and loops in
// the IFD chain end the walk.
import { ascii, fail, reader } from "../bytes.js";

/** Bytes per value of each TIFF field type. */
const SIZES = /** @type {Record<number, number>} */ ({
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
});

/**
 * @typedef {{ type: number, count: number, at: number }} Entry
 * @typedef {ReturnType<typeof ifdAt>} Ifd
 */

/**
 * One IFD at `offset` (relative to the header), or null when it lies outside the file.
 * @param {ReturnType<typeof reader>} r
 * @param {number} base
 * @param {number} offset
 */
function ifdAt(r, base, offset) {
  const at = base + offset;
  if (offset < 8 || at + 2 > r.length) return null;
  const count = r.u16(at);
  if (count === 0 || count > 4096 || at + 2 + count * 12 > r.length) return null;
  /** @type {Map<number, Entry>} */
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    const type = r.u16(e + 2);
    const n = r.u32(e + 4);
    const size = (SIZES[type] ?? 1) * n;
    const value = size <= 4 ? e + 8 : base + r.u32(e + 8);
    if (value + size <= r.length) entries.set(r.u16(e), { type, count: n, at: value });
  }
  const next = at + 2 + count * 12 + 4 <= r.length ? r.u32(at + 2 + count * 12) : 0;

  /** Every value of a numeric tag, as numbers (rationals divided out). */
  const numbers = (/** @type {number} */ tag) => {
    const e = entries.get(tag);
    if (!e) return [];
    const out = [];
    for (let i = 0; i < Math.min(e.count, 1024); i++) {
      const p = e.at + i * (SIZES[e.type] ?? 1);
      switch (e.type) {
        case 1:
        case 7:
          out.push(r.u8(p));
          break;
        case 3:
          out.push(r.u16(p));
          break;
        case 4:
        case 13:
          out.push(r.u32(p));
          break;
        case 5:
          out.push(r.u32(p) / (r.u32(p + 4) || 1));
          break;
        case 6:
          out.push(r.i8(p));
          break;
        case 8:
          out.push(r.i16(p));
          break;
        case 9:
          out.push(r.i32(p));
          break;
        case 10:
          out.push(r.i32(p) / (r.i32(p + 4) || 1));
          break;
        case 11:
          out.push(r.f32(p));
          break;
        case 12:
          out.push(r.f64(p));
          break;
        default:
          return out;
      }
    }
    return out;
  };

  return {
    entries,
    next,
    has: (/** @type {number} */ tag) => entries.has(tag),
    numbers,
    number: (/** @type {number} */ tag) => numbers(tag)[0],
    /** An ASCII tag, without its NUL and trailing spaces. */
    text: (/** @type {number} */ tag) => {
      const e = entries.get(tag);
      if (!e || (e.type !== 2 && e.type !== 7 && e.type !== 1)) return undefined;
      const text = ascii(r.bytes, e.at, e.count)
        .replace(/\0[\s\S]*$/, "")
        .trim();
      return text === "" ? undefined : text;
    },
    /** The bytes of an UNDEFINED or BYTE tag, where they are in the file. */
    bytes: (/** @type {number} */ tag) => {
      const e = entries.get(tag);
      return e ? r.bytes.subarray(e.at, e.at + e.count * (SIZES[e.type] ?? 1)) : undefined;
    },
  };
}

/**
 * Open the TIFF structure whose header is at `base`.
 * @param {Uint8Array} bytes
 * @param {number} [base]
 */
export function openTiff(bytes, base = 0) {
  const order = ascii(bytes, base, 2);
  if (order !== "II" && order !== "MM") fail("Its TIFF header is damaged.");
  const r = reader(bytes, order === "II");
  const first = r.u32(base + 4);
  return {
    le: r.le,
    /** @param {number} offset */
    ifd: (offset) => ifdAt(r, base, offset),
    /** IFD0, IFD1 ... along the chain. */
    chain() {
      /** @type {Ifd[]} */
      const out = [];
      const seen = new Set();
      let offset = first;
      while (offset && !seen.has(offset) && out.length < 64) {
        seen.add(offset);
        const ifd = ifdAt(r, base, offset);
        if (!ifd) break;
        out.push(ifd);
        offset = ifd.next;
      }
      return out;
    },
    /** The chain and every SubIFD under it (tag 0x14a), depth first. */
    all() {
      /** @type {Ifd[]} */
      const out = [];
      const seen = new Set();
      const visit = (/** @type {Ifd} */ ifd, depth = 0) => {
        out.push(ifd);
        if (depth > 3) return;
        for (const offset of ifd.numbers(0x14a)) {
          if (seen.has(offset) || out.length >= 64) continue;
          seen.add(offset);
          const sub = ifdAt(r, base, offset);
          if (sub) visit(sub, depth + 1);
        }
      };
      for (const ifd of this.chain()) visit(ifd);
      return out;
    },
    /** The IFD a pointer tag (0x8769 EXIF, 0x8825 GPS) of `ifd` names. */
    pointed(/** @type {Ifd} */ ifd, /** @type {number} */ tag) {
      const offset = ifd.number(tag);
      return offset ? ifdAt(r, base, offset) : null;
    },
  };
}
