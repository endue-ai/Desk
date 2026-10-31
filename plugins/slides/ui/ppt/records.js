// PowerPoint 97-2003 binary records ([MS-PPT], [MS-ODRAW]): record headers, containers, the persist
// directory that maps persist ids to stream offsets, text atoms with their paragraph levels, and
// the pictures of the BLIP store. No DOM.
import { i16, i32, u16, u32, utf16le } from "../bytes.js";

/** @typedef {{ type: number, inst: number, ver: number, at: number, body: number, len: number }} PptRecord */

export const T = {
  document: 0x03e8,
  documentAtom: 0x03e9,
  slide: 0x03ee,
  slideAtom: 0x03ef,
  notes: 0x03f0,
  notesAtom: 0x03f1,
  slidePersist: 0x03f3,
  slideShowInfo: 0x03f9,
  drawingGroup: 0x040b,
  drawing: 0x040c,
  slideList: 0x0ff0,
  userEdit: 0x0ff5,
  outlineRef: 0x0f9e,
  textHeader: 0x0f9f,
  textChars: 0x0fa0,
  styleText: 0x0fa1,
  textBytes: 0x0fa8,
  placeholder: 0x0bc3,
  persistDir: 0x1772,
  cryptSession: 0x2f14,
  bstore: 0xf001,
  spgr: 0xf003,
  sp: 0xf004,
  fbse: 0xf007,
  spgrAtom: 0xf009,
  fopt: 0xf00b,
  clientTextbox: 0xf00d,
  childAnchor: 0xf00f,
  clientAnchor: 0xf010,
  clientData: 0xf011,
};

/** The record at `at`, or null past the end. @param {Uint8Array} b @param {number} at @returns {PptRecord | null} */
export function recordAt(b, at) {
  if (at < 0 || at + 8 > b.length) return null;
  const head = u16(b, at);
  const len = u32(b, at + 4);
  return {
    ver: head & 0xf,
    inst: head >> 4,
    type: u16(b, at + 2),
    at,
    body: at + 8,
    len: Math.min(len, b.length - at - 8),
  };
}

/** The records inside a container (or between two offsets). @param {Uint8Array} b @param {PptRecord | null} parent */
export function childrenOf(b, parent, start = 0, end = b.length) {
  /** @type {PptRecord[]} */
  const out = [];
  let at = parent ? parent.body : start;
  const stop = parent ? parent.body + parent.len : end;
  while (at + 8 <= stop) {
    const rec = recordAt(b, at);
    if (!rec) break;
    out.push(rec);
    at = rec.body + rec.len;
  }
  return out;
}

/** The first child of a type. @param {Uint8Array} b @param {PptRecord | null | undefined} parent @param {number} type */
export const childOf = (b, parent, type) =>
  parent ? (childrenOf(b, parent).find((r) => r.type === type) ?? null) : null;

/** Every record under `parent`, depth first, containers included. @param {Uint8Array} b @param {PptRecord} parent */
export function descendants(b, parent) {
  /** @type {PptRecord[]} */
  const out = [];
  const visit = (/** @type {PptRecord} */ rec, /** @type {number} */ depth) => {
    for (const child of childrenOf(b, rec)) {
      out.push(child);
      if (child.ver === 0xf && depth < 32) visit(child, depth + 1);
    }
  };
  visit(parent, 0);
  return out;
}

/**
 * The persist directory: persist id -> stream offset, newest edit winning, and the document's
 * persist id and whether the file is encrypted.
 * @param {Uint8Array} doc  the PowerPoint Document stream
 * @param {number} currentEdit  the offset the Current User stream names
 */
export function persistDirectory(doc, currentEdit) {
  /** @type {Map<number, number>} */
  const offsets = new Map();
  let docPersist = 0;
  let encrypted = false;
  const seen = new Set();
  for (let at = currentEdit; !seen.has(at); ) {
    seen.add(at);
    const edit = recordAt(doc, at);
    if (!edit || edit.type !== T.userEdit) break;
    if (!docPersist) docPersist = u32(doc, edit.body + 16);
    if (edit.len >= 32 && u32(doc, edit.body + 28)) encrypted = true;
    const dir = recordAt(doc, u32(doc, edit.body + 12));
    if (dir?.type === T.persistDir) {
      for (let p = dir.body; p + 4 <= dir.body + dir.len; ) {
        const entry = u32(doc, p);
        const first = entry & 0xfffff;
        const count = entry >>> 20;
        p += 4;
        for (let i = 0; i < count && p + 4 <= dir.body + dir.len; i++, p += 4)
          if (!offsets.has(first + i)) offsets.set(first + i, u32(doc, p));
      }
    }
    const last = u32(doc, edit.body + 8);
    if (last === 0 || last === at) break;
    at = last;
  }
  return { offsets, docPersist, encrypted };
}

/** TextBytesAtom: one byte per character, the low byte of UTF-16. @param {Uint8Array} b */
const bytesText = (b) => {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return s;
};

/** The text of a TextCharsAtom or TextBytesAtom, or null. @param {Uint8Array} b @param {PptRecord} rec */
export function textOfAtom(b, rec) {
  if (rec.type === T.textChars) return utf16le(b.subarray(rec.body, rec.body + rec.len));
  if (rec.type === T.textBytes) return bytesText(b.subarray(rec.body, rec.body + rec.len));
  return null;
}

/** Bytes each TextPFException field takes, by mask bit, in field order. */
const PF_FIELDS = [
  [0x0000000f, 2],
  [0x00000080, 2],
  [0x00000010, 2],
  [0x00000040, 2],
  [0x00000020, 4],
  [0x00000800, 2],
  [0x00001000, 2],
  [0x00002000, 2],
  [0x00004000, 2],
  [0x00000100, 2],
  [0x00000400, 2],
  [0x00008000, 2],
];

/**
 * The paragraph levels and bullets a StyleTextPropAtom gives a text, one per paragraph. A run covers
 * a number of characters, paragraph ends included; a paragraph takes the run its first character is in.
 * @param {Uint8Array} b @param {PptRecord | null} rec @param {string} text
 * @returns {Array<{ level: number, bullet: boolean }>}
 */
export function paragraphStyles(b, rec, text) {
  /** @type {Array<{ level: number, bullet: boolean }>} */
  const out = [];
  if (!rec) return out;
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\r" && i + 1 < text.length) starts.push(i + 1);
  let at = rec.body;
  const end = rec.body + rec.len;
  let covered = 0;
  while (covered <= text.length && out.length < starts.length && at + 10 <= end) {
    const count = Math.max(1, u32(b, at));
    const level = u16(b, at + 4);
    const masks = u32(b, at + 6);
    at += 10;
    let bullet = false;
    for (const [bit, size] of PF_FIELDS) {
      if (!(masks & (bit ?? 0))) continue;
      if (bit === 0x0000000f) bullet = Boolean(u16(b, at) & 1);
      at += size ?? 2;
    }
    if (masks & 0x00100000) at += 2 + u16(b, at) * 4;
    if (masks & 0x00010000) at += 2;
    if (masks & 0x000e0000) at += 2;
    if (masks & 0x00200000) at += 2;
    while (out.length < starts.length && (starts[out.length] ?? 0) < covered + count)
      out.push({ level: Math.min(4, level), bullet });
    covered += count;
  }
  return out;
}

/**
 * A shape's anchor as [left, top, right, bottom]: a client anchor in master units (576 per inch,
 * stored top, left, right, bottom), a child anchor or group frame in its group's units.
 */
export function anchorOf(/** @type {Uint8Array} */ b, /** @type {PptRecord | null} */ rec) {
  if (!rec) return null;
  if (rec.type === T.childAnchor || rec.type === T.spgrAtom)
    return [i32(b, rec.body), i32(b, rec.body + 4), i32(b, rec.body + 8), i32(b, rec.body + 12)];
  if (rec.len >= 16)
    return [i32(b, rec.body + 4), i32(b, rec.body), i32(b, rec.body + 8), i32(b, rec.body + 12)];
  if (rec.len >= 8)
    return [i16(b, rec.body + 2), i16(b, rec.body), i16(b, rec.body + 4), i16(b, rec.body + 6)];
  return null;
}

/** OfficeArtFOPT properties by property id (simple ones only). @param {Uint8Array} b @param {PptRecord | null} rec */
export function propertiesOf(b, rec) {
  /** @type {Map<number, number>} */
  const props = new Map();
  if (!rec) return props;
  for (let i = 0; i < rec.inst && rec.body + i * 6 + 6 <= rec.body + rec.len; i++)
    props.set(u16(b, rec.body + i * 6) & 0x3fff, u32(b, rec.body + i * 6 + 2));
  return props;
}

/** A BLIP record as displayable bytes (JPEG, PNG, TIFF, DIB made a BMP), or null for metafiles. */
export function blipBytes(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  const rec = recordAt(b, at);
  if (!rec || rec.type < 0xf018 || rec.type > 0xf117) return null;
  const twoUids = rec.inst & 1;
  const kind = rec.inst & ~1;
  if ([0x3d4, 0x216, 0x542].includes(kind)) return null;
  const start = rec.body + (twoUids ? 32 : 16) + 1;
  const data = b.subarray(start, rec.body + rec.len);
  if (kind !== 0x7a8) return data;
  // A DIB is a BMP without its 14-byte file header.
  const header = u32(data, 0);
  const bits = u16(data, 14);
  const colors = u32(data, 32) || (bits <= 8 ? 1 << bits : 0);
  const bmp = new Uint8Array(14 + data.length);
  const view = new DataView(bmp.buffer);
  bmp.set([0x42, 0x4d]);
  view.setUint32(2, bmp.length, true);
  view.setUint32(10, 14 + header + colors * 4, true);
  bmp.set(data, 14);
  return bmp;
}
