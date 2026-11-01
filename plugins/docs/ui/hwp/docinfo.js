// The DocInfo stream: the ID mappings that number everything else. Fonts per language, character
// shapes, paragraph shapes, border fills, numberings, bullets, styles and the BinData items, as
// HWP 5.0 lays them out. Paragraph indents and spacing are stored at twice their HWPUNIT size.
import { Reader } from "../bytes.js";
import { pt } from "../model.js";
import { colorref, TAG, tree, wstr } from "./records.js";

/**
 * @typedef {import("../model.js").TextRun} TextRun
 * @typedef {{ props: Partial<TextRun>, sizes: number[] }} CharShape  sizes: points per language
 * @typedef {{ align?: import("../model.js").Align, indent?: import("../model.js").Indent, spacing?: import("../model.js").Spacing, head: number, level: number, numbering: number, breakBefore: boolean }} ParaShape
 *   head: 0 none, 1 outline, 2 number, 3 bullet; level: 0-based.
 * @typedef {{ text: string, shape: number, start: number }} Level
 * @typedef {{ border: boolean, fill?: string }} Fill
 * @typedef {{ name: string, para: number, char: number }} Style
 * @typedef {{ kind: number, id: number, ext: string, compress: number }} BinItem
 *   kind: 0 a linked file, 1 an embedded file, 2 an OLE storage; compress: 0 as the document, 1 yes, 2 no.
 * @typedef {{ chars: CharShape[], paras: ParaShape[], fills: Fill[], numberings: Level[][], bullets: string[], styles: Style[], bins: BinItem[] }} Info
 *   Lists are 0-based; references from the body to fills, numberings, bullets and bins are 1-based.
 */

const ALIGN = /** @type {const} */ (["justify", "left", "right", "center", "justify", "justify"]);

/** Serif faces a Mac lacks fall back to its own Korean serif instead of the desk's sans. */
const SERIF = /바탕|명조|궁서|Batang|Myeongjo|Myungjo|Gungsuh|serif/i;
const SERIF_FALLBACK = ["AppleMyungjo", "Noto Serif KR"];

/** @param {Uint8Array} bytes the inflated DocInfo stream @returns {Info} */
export function readDocInfo(bytes) {
  const recs = tree(bytes).kids.flatMap((r) => [r, ...r.kids]);
  /** @type {Info} */
  const info = {
    chars: [],
    paras: [],
    fills: [],
    numberings: [],
    bullets: [],
    styles: [],
    bins: [],
  };
  let counts = /** @type {number[]} */ ([]);
  /** Each language's fonts, each font its name and the substitute Hangul names for it. */
  /** @type {string[][][]} */
  const faces = [[], [], [], [], [], [], []];
  let face = 0;
  for (const rec of recs) {
    const r = new Reader(rec.data);
    switch (rec.tag) {
      case TAG.ID_MAPPINGS:
        counts = Array.from({ length: rec.data.length >> 2 }, (_, i) => r.i32(i * 4));
        break;
      case TAG.FACE_NAME: {
        // Fonts come grouped by language: Hangul, Latin, Hanja, Japanese, other, symbol, user.
        const count = (/** @type {number} */ lang) => Math.max(0, counts[lang + 1] ?? 0);
        let lang = 0;
        let seen = face;
        while (counts.length > 7 && lang < 6 && seen >= count(lang)) {
          seen -= count(lang);
          lang++;
        }
        const name = wstr(r, 1);
        faces[lang]?.push(r.u8(0) & 0x80 ? [name.text, wstr(r, name.end + 1).text] : [name.text]);
        face++;
        break;
      }
      case TAG.BORDER_FILL:
        info.fills.push(borderFill(r));
        break;
      case TAG.CHAR_SHAPE:
        info.chars.push(charShape(r, faces));
        break;
      case TAG.NUMBERING:
        info.numberings.push(numbering(r));
        break;
      case TAG.BULLET:
        info.bullets.push(String.fromCharCode(r.u16(12)));
        break;
      case TAG.PARA_SHAPE:
        info.paras.push(paraShape(r));
        break;
      case TAG.STYLE: {
        const local = wstr(r, 0);
        const english = wstr(r, local.end);
        const at = english.end;
        info.styles.push({
          name: local.text || english.text,
          para: r.u16(at + 4),
          char: r.u16(at + 6),
        });
        break;
      }
      case TAG.BIN_DATA: {
        const props = r.u16(0);
        const kind = props & 0xf;
        info.bins.push({
          kind,
          id: kind === 0 ? 0 : r.u16(2),
          ext: kind === 1 ? wstr(r, 4).text.toLowerCase() : "",
          compress: (props >> 4) & 3,
        });
        break;
      }
    }
  }
  return info;
}

/** Four borders (type, width, colour each), a diagonal, then the fill; type 0 draws no line. */
function borderFill(/** @type {Reader} */ r) {
  let border = false;
  for (let side = 0; side < 4; side++) if (r.u8(2 + side * 6) !== 0) border = true;
  /** @type {Fill} */
  const out = { border };
  if (r.u32(32) & 1) {
    const fill = colorref(r.u32(36));
    if (fill && fill !== "#FFFFFF") out.fill = fill;
  }
  return out;
}

/** @param {Reader} r @param {string[][][]} faces @returns {CharShape} */
function charShape(r, faces) {
  const base = r.i32(42) / 100;
  const sizes = Array.from({ length: 7 }, (_, lang) => pt((base * (r.u8(28 + lang) || 100)) / 100));
  const props = r.u32(46);
  /** @type {Partial<TextRun>} */
  const out = {};
  if (props & 1) out.italic = true;
  if (props & 2) out.bold = true;
  // Lines: underline at the bottom (1), centre (2, a strikeout) or top (3), and the strikeout,
  // each with a line shape; Hangul marks an unused line with shape 15, the 3D line.
  const under = (props >>> 2) & 3;
  if (((props >>> 4) & 15) ^ 15) {
    if (under === 1 || under === 3) out.underline = true;
    else if (under === 2) out.strike = true;
  }
  if ((props >>> 18) & 7 && ((props >>> 26) & 15) !== 15) out.strike = true;
  if (props & (1 << 15)) out.script = "super";
  else if (props & (1 << 16)) out.script = "sub";
  const color = colorref(r.u32(52));
  if (color && color !== "#000000") out.color = color;
  const shade = colorref(r.u32(60));
  if (shade && shade !== "#FFFFFF") out.highlight = shade;
  // The Latin and Hangul faces first, then their substitutes.
  const latin = faces[1]?.[r.u16(2)] ?? [];
  const hangul = faces[0]?.[r.u16(0)] ?? [];
  const names = [...new Set([latin[0], hangul[0], latin[1], hangul[1]].filter((n) => !!n))];
  if (names.some((n) => SERIF.test(n ?? ""))) names.push(...SERIF_FALLBACK);
  if (names.length) out.font = names.join(", ");
  return { props: out, sizes };
}

/** @param {Reader} r @returns {ParaShape} */
function paraShape(r) {
  const p1 = r.u32(0);
  const half = (/** @type {number} */ at) => pt(r.i32(at) / 200);
  /** @type {ParaShape} */
  const out = {
    head: (p1 >>> 23) & 3,
    level: (p1 >>> 25) & 7,
    numbering: r.u16(30),
    breakBefore: (p1 & (1 << 19)) !== 0,
  };
  // 5.1 files keep levels 8 to 10 in a DWORD after the 54 bytes of 5.0.
  if (r.bytes.length >= 58 && out.level === 6) out.level = Math.min(9, Math.max(6, r.u32(54)));
  out.align = ALIGN[(p1 >>> 2) & 7] ?? "justify";
  const [left, right, first] = [half(4), half(8), half(12)];
  if (left || right || first) out.indent = { left, right, first };
  /** @type {import("../model.js").Spacing} */
  const spacing = {};
  const [before, after] = [half(16), half(20)];
  if (before) spacing.before = before;
  if (after) spacing.after = after;
  const modern = r.bytes.length >= 54;
  const type = modern ? r.u32(46) & 31 : p1 & 3;
  const value = modern ? r.u32(50) : r.i32(24);
  // Percent is of the font size; the model's line is a multiple of single spacing (1.17 em). A
  // fixed height is stored doubled, like the indents.
  if (type === 0 && value > 0) spacing.line = Math.round((value / 117) * 100) / 100;
  else if (type === 1 && value > 0) Object.assign(spacing, { line: pt(value / 200), exact: true });
  if (Object.keys(spacing).length) out.spacing = spacing;
  return out;
}

/** Seven levels (ten in 5.1): a 12-byte head (bits 5-8 the number shape), the format text. */
function numbering(/** @type {Reader} */ r) {
  /** @type {Level[]} */
  const levels = [];
  let at = 0;
  const head = () => {
    const props = r.u32(at);
    const text = wstr(r, at + 12);
    levels.push({ text: text.text, shape: (props >>> 5) & 0xf, start: 1 });
    at = text.end;
  };
  for (let i = 0; i < 7 && at + 14 <= r.bytes.length; i++) head();
  const start = r.u16(at);
  at += 2;
  if (at + 28 <= r.bytes.length) {
    for (let i = 0; i < 7; i++) {
      const level = levels[i];
      if (level) level.start = r.u32(at + i * 4) || start || 1;
    }
    at += 28;
  } else for (const level of levels) level.start = start || 1;
  for (let i = 7; i < 10 && at + 14 <= r.bytes.length; i++) head();
  for (let i = 7; i < levels.length; i++) {
    const level = levels[i];
    if (level) level.start = r.u32(at + (i - 7) * 4) || 1;
  }
  return levels;
}
