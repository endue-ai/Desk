// Text styles of PowerPoint 97-2003 ([MS-PPT] 2.9): paragraph (TextPFException) and character
// (TextCFException) exceptions, the master's levels (TextMasterStyleAtom), a text's runs
// (StyleTextPropAtom) and its ruler (TextRuler). Only the fields a mask names are set. No DOM.
import { i16, u16, u32 } from "./records.js";

/**
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {{
 *   hasBullet?: boolean, bulletHasFont?: boolean, bulletHasColor?: boolean, bulletHasSize?: boolean,
 *   bulletChar?: number, bulletFont?: number, bulletSize?: number, bulletColor?: number,
 *   align?: number, lineSpacing?: number, spaceBefore?: number, spaceAfter?: number,
 *   leftMargin?: number, indent?: number
 * }} PF  Spacing: >= 0 a percentage, < 0 master units (576 an inch). Margins in master units.
 * @typedef {{
 *   bold?: boolean, italic?: boolean, underline?: boolean, font?: number, size?: number,
 *   color?: number, position?: number
 * }} CF  color: a ColorIndexStruct as one number.
 * @typedef {{ pf: PF, cf: CF }} Level
 * @typedef {{ count: number, level: number, pf: PF }} PFRun
 * @typedef {{ count: number, cf: CF }} CFRun
 * @typedef {Array<{ leftMargin?: number, indent?: number }>} Ruler  by indent level
 */

/**
 * A TextPFException at `at`.
 * @param {Uint8Array} b @param {number} at @returns {{ pf: PF, end: number }}
 */
export function readPF(b, at) {
  const masks = u32(b, at);
  /** @type {PF} */
  const pf = {};
  let p = at + 4;
  const take = (/** @type {number} */ size) => {
    const v = size === 4 ? u32(b, p) : i16(b, p);
    p += size;
    return v;
  };
  if (masks & 0x0f) {
    const flags = take(2);
    if (masks & 1) pf.hasBullet = Boolean(flags & 1);
    if (masks & 2) pf.bulletHasFont = Boolean(flags & 2);
    if (masks & 4) pf.bulletHasColor = Boolean(flags & 4);
    if (masks & 8) pf.bulletHasSize = Boolean(flags & 8);
  }
  if (masks & 0x80) pf.bulletChar = take(2) & 0xffff;
  if (masks & 0x10) pf.bulletFont = take(2) & 0xffff;
  if (masks & 0x40) pf.bulletSize = take(2);
  if (masks & 0x20) pf.bulletColor = take(4);
  if (masks & 0x800) pf.align = take(2);
  if (masks & 0x1000) pf.lineSpacing = take(2);
  if (masks & 0x2000) pf.spaceBefore = take(2);
  if (masks & 0x4000) pf.spaceAfter = take(2);
  if (masks & 0x100) pf.leftMargin = take(2);
  if (masks & 0x400) pf.indent = take(2);
  if (masks & 0x8000) p += 2;
  if (masks & 0x100000) p += 2 + u16(b, p) * 4;
  if (masks & 0x10000) p += 2;
  if (masks & 0xe0000) p += 2;
  if (masks & 0x200000) p += 2;
  return { pf, end: p };
}

/**
 * A TextCFException at `at`.
 * @param {Uint8Array} b @param {number} at @returns {{ cf: CF, end: number }}
 */
export function readCF(b, at) {
  const masks = u32(b, at);
  /** @type {CF} */
  const cf = {};
  let p = at + 4;
  if (masks & 0x3cb7) {
    const style = u16(b, p);
    p += 2;
    if (masks & 1) cf.bold = Boolean(style & 1);
    if (masks & 2) cf.italic = Boolean(style & 2);
    if (masks & 4) cf.underline = Boolean(style & 4);
  }
  if (masks & 0x10000) {
    cf.font = u16(b, p);
    p += 2;
  }
  if (masks & 0x200000) p += 2;
  if (masks & 0x400000) {
    // An ANSI font stands in when no other font is named.
    if (cf.font === undefined) cf.font = u16(b, p);
    p += 2;
  }
  if (masks & 0x800000) p += 2;
  if (masks & 0x20000) {
    cf.size = i16(b, p);
    p += 2;
  }
  if (masks & 0x40000) {
    cf.color = u32(b, p);
    p += 4;
  }
  if (masks & 0x80000) {
    cf.position = i16(b, p);
    p += 2;
  }
  if (masks & 0x100000) p += 4;
  if (masks & 0x1000000) p += 2;
  if (masks & 0x2000000) p += 2;
  if (masks & 0x4000000) p += 4;
  if (cf.font === 0xffff) delete cf.font;
  return { cf, end: p };
}

/**
 * A TextMasterStyleAtom's levels, by indent level. Text types 5 and up name each level's number.
 * @param {Uint8Array} b @param {PptRecord} rec @returns {Level[]}
 */
export function masterLevels(b, rec) {
  /** @type {Level[]} */
  const levels = [];
  const end = rec.body + rec.len;
  const count = Math.min(5, u16(b, rec.body));
  let at = rec.body + 2;
  for (let i = 0; i < count && at + 8 <= end; i++) {
    let level = i;
    if (rec.inst >= 5) {
      level = Math.min(4, u16(b, at));
      at += 2;
    }
    const { pf, end: afterPF } = readPF(b, at);
    const { cf, end: afterCF } = readCF(b, afterPF);
    at = afterCF;
    levels[level] = { pf, cf };
  }
  return levels;
}

/**
 * A StyleTextPropAtom's paragraph and character runs for a text of `length` characters (the
 * runs also cover one character past the end).
 * @param {Uint8Array} b @param {PptRecord | null} rec @param {number} length
 * @returns {{ paragraphs: PFRun[], characters: CFRun[] }}
 */
export function textRuns(b, rec, length) {
  /** @type {PFRun[]} */
  const paragraphs = [];
  /** @type {CFRun[]} */
  const characters = [];
  if (!rec) return { paragraphs, characters };
  const end = rec.body + rec.len;
  let at = rec.body;
  for (let covered = 0; covered <= length && at + 10 <= end; ) {
    const count = u32(b, at);
    const level = Math.min(4, u16(b, at + 4));
    const { pf, end: next } = readPF(b, at + 6);
    paragraphs.push({ count, level, pf });
    covered += Math.max(1, count);
    at = next;
  }
  for (let covered = 0; covered <= length && at + 8 <= end; ) {
    const count = u32(b, at);
    const { cf, end: next } = readCF(b, at + 4);
    characters.push({ count, cf });
    covered += Math.max(1, count);
    at = next;
  }
  return { paragraphs, characters };
}

/** A TextRuler's margins and indents by level. @param {Uint8Array} b @param {PptRecord | null} rec @returns {Ruler} */
export function rulerOf(b, rec) {
  /** @type {Ruler} */
  const out = [];
  if (!rec) return out;
  const masks = u32(b, rec.body);
  let at = rec.body + 4;
  if (masks & 2) at += 2;
  if (masks & 1) at += 2;
  if (masks & 4) at += 2 + u16(b, at) * 4;
  for (let level = 0; level < 5; level++) {
    /** @type {{ leftMargin?: number, indent?: number }} */
    const entry = {};
    if (masks & (1 << (3 + level))) {
      entry.leftMargin = i16(b, at);
      at += 2;
    }
    if (masks & (1 << (8 + level))) {
      entry.indent = i16(b, at);
      at += 2;
    }
    out.push(entry);
  }
  return out;
}
