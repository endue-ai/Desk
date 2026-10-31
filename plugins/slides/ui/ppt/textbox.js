// The text of a shape ([MS-PPT] 2.9.76 OfficeArtClientTextbox): its type, characters, style runs,
// ruler, fields and links, either in the shape or in the slide's outline (SlideListWithText) that
// an OutlineTextRefAtom points into; and automatic numbering from the PowerPoint 2000 extension
// (StyleTextProp9Atom). No DOM.
import { utf16le } from "../bytes.js";
import { childOf, childrenOf, T, textOfAtom, u16, u32 } from "./records.js";
import { rulerOf, textRuns } from "./styles.js";

/**
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {import("./text.js").PptText} PptText
 * @typedef {import("./text.js").Field} Field
 * @typedef {{ type: number, records: PptRecord[] }} Outline  one text of a SlideListWithText entry
 * @typedef {Array<{ scheme: number, start: number } | null>} Numbers
 */

const FIELDS = /** @type {Record<number, Field>} */ ({
  [T.slideNumberMC]: "slide",
  [T.dateTimeMC]: "date",
  [T.genericDateMC]: "date",
  [T.rtfDateTimeMC]: "date",
  [T.footerMC]: "footer",
  [T.headerMC]: "header",
});

/** The texts of a SlideListWithText entry: each starts at a TextHeaderAtom. @param {Uint8Array} b @param {PptRecord[]} records */
export function outlinesOf(b, records) {
  /** @type {Outline[]} */
  const out = [];
  for (const rec of records) {
    if (rec.type === T.textHeader) out.push({ type: u32(b, rec.body), records: [] });
    else out.at(-1)?.records.push(rec);
  }
  return out;
}

/**
 * A text from its records (those after its TextHeaderAtom).
 * @param {Uint8Array} b @param {PptRecord[]} records @param {number} type @param {Numbers} numbers
 * @returns {PptText | null}
 */
export function textFrom(b, records, type, numbers = []) {
  const atom = records.find((r) => r.type === T.textChars || r.type === T.textBytes);
  if (!atom) return null;
  const text = textOfAtom(b, atom) ?? "";
  const style = records.find((r) => r.type === T.styleText) ?? null;
  const { paragraphs, characters } = textRuns(b, style, text.length);
  /** @type {Map<number, Field>} */
  const fields = new Map();
  /** @type {Array<[number, number]>} */
  const links = [];
  for (const rec of records) {
    const field = FIELDS[rec.type];
    if (field) fields.set(u32(b, rec.body), field);
    if (rec.type === T.textInteractive) links.push([u32(b, rec.body), u32(b, rec.body + 4)]);
  }
  return {
    text,
    type,
    paragraphs,
    characters,
    ruler: rulerOf(b, records.find((r) => r.type === T.textRuler) ?? null),
    fields,
    links,
    numbers,
  };
}

/**
 * A shape's text: in its client textbox, or the outline text its OutlineTextRefAtom names.
 * @param {Uint8Array} b @param {PptRecord | null} box @param {PptRecord | null} data
 * @param {Outline[]} outline @returns {PptText | null}
 */
export function readText(b, box, data, outline) {
  const records = childrenOf(b, box);
  const header = records.find((r) => r.type === T.textHeader);
  const ref = records.find((r) => r.type === T.outlineRef);
  const numbers = numbersOf(b, ninthOf(b, data));
  if (ref) {
    const found = outline[u32(b, ref.body)];
    if (!found) return null;
    const ruler = records.find((r) => r.type === T.textRuler);
    return textFrom(b, ruler ? [...found.records, ruler] : found.records, found.type, numbers);
  }
  return header ? textFrom(b, records, u32(b, header.body), numbers) : null;
}

/** The StyleTextProp9Atom in a shape's "___PPT9" programmable tag, or null. @param {Uint8Array} b @param {PptRecord | null} data */
function ninthOf(b, data) {
  for (const tag of childrenOf(b, childOf(b, data, T.progTags))) {
    if (tag.type !== T.progBinaryTag) continue;
    const name = childOf(b, tag, T.cString);
    const blob = childOf(b, tag, T.binaryTagData);
    if (!name || !blob || utf16le(b.subarray(name.body, name.body + name.len)) !== "___PPT9")
      continue;
    return childrenOf(b, blob).find((r) => r.type === T.styleText9) ?? null;
  }
  return null;
}

/**
 * Automatic numbering by paragraph run from a StyleTextProp9Atom: each entry is a TextPFException9,
 * a TextCFException9 and a TextSIException.
 * @param {Uint8Array} b @param {PptRecord | null} rec @returns {Numbers}
 */
export function numbersOf(b, rec) {
  /** @type {Numbers} */
  const out = [];
  if (!rec) return out;
  const end = rec.body + rec.len;
  for (let at = rec.body; at + 12 <= end; ) {
    const masks = u32(b, at);
    at += 4;
    if (masks & 0x800000) at += 2;
    let numbered = false;
    if (masks & 0x1000000) {
      numbered = Boolean(u16(b, at));
      at += 2;
    }
    /** @type {{ scheme: number, start: number } | null} */
    let number = null;
    if (masks & 0x2000000) {
      number = { scheme: u16(b, at), start: Math.max(1, u16(b, at + 2)) };
      at += 4;
    }
    out.push(numbered ? (number ?? { scheme: 3, start: 1 }) : null);
    // TextCFException9: only its pp10ext field may be present.
    const cf = u32(b, at);
    at += 4 + (cf & 0x100000 ? 4 : 0);
    // TextSIException.
    const si = u32(b, at);
    at += 4;
    for (const bit of [1, 2, 4, 0x40]) if (si & bit) at += 2;
    if (si & 0x20) at += 4;
    if (si & 0x200) at += 4 + u32(b, at) * 4;
  }
  return out;
}
