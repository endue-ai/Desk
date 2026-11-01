// HWP 5.0 data records: a 32-bit header (tag 10 bits, level 10 bits, size 12 bits, 0xFFF for a
// DWORD size after it), read as a tree where a record's children are the deeper records after it.
// Tag values and layouts follow Hancom's published "HWP 5.0 file format" document (revision 1.3).
import { Reader } from "../bytes.js";

/** @typedef {{ tag: number, level: number, data: Uint8Array, kids: Rec[] }} Rec */

export const TAG = /** @type {const} */ ({
  ID_MAPPINGS: 17,
  BIN_DATA: 18,
  FACE_NAME: 19,
  BORDER_FILL: 20,
  CHAR_SHAPE: 21,
  NUMBERING: 23,
  BULLET: 24,
  PARA_SHAPE: 25,
  STYLE: 26,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  PARA_CHAR_SHAPE: 68,
  PARA_LINE_SEG: 69,
  PARA_RANGE_TAG: 70,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  PAGE_DEF: 73,
  FOOTNOTE_SHAPE: 74,
  SHAPE_COMPONENT: 76,
  TABLE: 77,
  SHAPE_OLE: 84,
  SHAPE_PICTURE: 85,
  EQEDIT: 88,
  SHAPE_TEXTART: 90,
  VIDEO_DATA: 98,
});

/** Every record of a stream, in order, with an empty child list. */
export function records(/** @type {Uint8Array} */ bytes) {
  const r = new Reader(bytes);
  /** @type {Rec[]} */
  const out = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const head = r.u32(at);
    let size = head >>> 20;
    at += 4;
    if (size === 0xfff) {
      size = r.u32(at);
      at += 4;
    }
    const data = bytes.subarray(at, Math.min(bytes.length, at + size));
    out.push({ tag: head & 0x3ff, level: (head >>> 10) & 0x3ff, data, kids: [] });
    at += size;
  }
  return out;
}

/** The records as a tree under a root of level -1; a level that jumps hangs on the nearest parent. */
export function tree(/** @type {Uint8Array} */ bytes) {
  /** @type {Rec} */
  const root = { tag: -1, level: -1, data: new Uint8Array(0), kids: [] };
  const stack = [root];
  for (const rec of records(bytes)) {
    while (stack.length > 1 && (stack.at(-1)?.level ?? -1) >= rec.level) stack.pop();
    stack.at(-1)?.kids.push(rec);
    stack.push(rec);
  }
  return root;
}

/** A control's four-letter id (MAKE_4CHID: first letter in the high byte) from its first DWORD. */
export const ctrlId = (/** @type {Uint8Array} */ data) =>
  String.fromCharCode(data[3] ?? 0, data[2] ?? 0, data[1] ?? 0, data[0] ?? 0);

/**
 * A WORD-counted UTF-16 string at `at`, and where the bytes after it start.
 * @param {Reader} r
 * @param {number} at
 */
export function wstr(r, at) {
  const count = r.u16(at);
  let text = "";
  for (let i = 0; i < count && at + 2 + i * 2 + 2 <= r.bytes.length; i++)
    text += String.fromCharCode(r.u16(at + 2 + i * 2));
  return { text, end: at + 2 + count * 2 };
}

/** A COLORREF (0x00BBGGRR) as "#RRGGBB"; undefined for the "none" value Hangul writes as -1. */
export function colorref(/** @type {number} */ value) {
  if (value >>> 24 === 0xff) return undefined;
  const hex = (/** @type {number} */ n) => n.toString(16).padStart(2, "0");
  return `#${hex(value & 0xff)}${hex((value >>> 8) & 0xff)}${hex((value >>> 16) & 0xff)}`.toUpperCase();
}

/** The records of a list: a LIST_HEADER's paragraphs are the PARA_HEADER siblings after it. */
export function listAfter(/** @type {Rec[]} */ kids, /** @type {number} */ index) {
  const head = kids[index];
  const count = head ? new Reader(head.data).u16(0) : 0;
  /** @type {Rec[]} */
  const paras = [];
  for (let i = index + 1; i < kids.length; i++) {
    const kid = /** @type {Rec} */ (kids[i]);
    if (kid.tag !== TAG.PARA_HEADER) break;
    paras.push(kid);
    if (count > 0 && paras.length >= count) break;
  }
  return paras;
}
