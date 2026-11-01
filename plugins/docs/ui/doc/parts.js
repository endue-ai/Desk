// Where the other stories live ([MS-DOC] 2.3, 2.8): the sections (PlcfSed and each SEPX), the
// header and footer stories (PlcfHdd), footnotes and endnotes (PlcffndRef, PlcffndTxt...), comments
// with their authors, ranges and dates (PlcfandRef, GrpXstAtnOwners, SttbfAtnBkmk, AtrdExtra), and
// the text box stories (PlcftxbxTxt).
import { Reader } from "../bytes.js";
import { PAIR, readPlc } from "./fib.js";
import { eachSprm } from "./sprm.js";

/**
 * @typedef {{ start: number, end: number, width: number, height: number, top: number, right: number, bottom: number, left: number, header: number, footer: number, bkc: number }} SectionProps
 *   Lengths in twips.
 * @typedef {{ cp: number, auto: boolean, text: [number, number] }} NoteRef
 * @typedef {{ cp: number, author: string, date: string, text: [number, number], range?: [number, number] }} CommentRef
 */

/** The story starts in CP space: main, footnotes, headers, macros, comments, endnotes, boxes. */
export function storyStarts(/** @type {import("./fib.js").Ccp} */ ccp) {
  const ftn = ccp.text;
  const hdd = ftn + ccp.ftn;
  const atn = hdd + ccp.hdd + ccp.mcr;
  const edn = atn + ccp.atn;
  const txbx = edn + ccp.edn;
  return { ftn, hdd, atn, edn, txbx, hdrTxbx: txbx + ccp.txbx };
}

/**
 * The sections of the main document with their page setup.
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 * @returns {SectionProps[]}
 */
export function readSections(wd, table, fib) {
  const r = new Reader(table);
  const w = new Reader(wd);
  const plc = readPlc(table, fib.pair(PAIR.plcfSed), 12);
  /** @type {SectionProps[]} */
  const out = [];
  for (let i = 0; i + 1 < plc.cps.length; i++) {
    const s = /** @type {SectionProps} */ ({
      start: plc.cps[i] ?? 0,
      end: Math.min(plc.cps[i + 1] ?? 0, fib.ccp.text),
      width: 12240,
      height: 15840,
      top: 1440,
      right: 1800,
      bottom: 1440,
      left: 1800,
      header: 720,
      footer: 720,
      bkc: 2,
    });
    const fc = r.i32(plc.data(i) + 2);
    if (fc >= 0 && fc + 2 <= wd.length) {
      const cb = Math.max(0, w.i16(fc));
      eachSprm(wd.subarray(fc + 2, fc + 2 + cb), (sprm, g, at) => {
        const u = g.u16(at);
        if (sprm === 0x3009) s.bkc = g.u8(at);
        else if (sprm === 0xb01f && u) s.width = u;
        else if (sprm === 0xb020 && u) s.height = u;
        else if (sprm === 0xb021) s.left = u;
        else if (sprm === 0xb022) s.right = u;
        else if (sprm === 0x9023) s.top = Math.abs(g.i16(at));
        else if (sprm === 0x9024) s.bottom = Math.abs(g.i16(at));
        else if (sprm === 0xb017) s.header = u;
        else if (sprm === 0xb018) s.footer = u;
      });
    }
    if (s.end > s.start) out.push(s);
  }
  return out;
}

/**
 * The text ranges of a PLC of story starts (PlcfHdd, PlcffndTxt, PlcfandTxt): story i is
 * [cps[i], cps[i + 1]) offset by `base`; the last two CPs begin no story.
 * @param {Uint8Array} table
 * @param {import("./fib.js").FcLcb} at
 * @param {number} base
 * @returns {Array<[number, number]>}
 */
export function storyRanges(table, at, base) {
  const { cps } = readPlc(table, at, 0);
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i + 2 < cps.length; i++)
    out.push([base + (cps[i] ?? 0), base + Math.max(cps[i] ?? 0, cps[i + 1] ?? 0)]);
  return out;
}

/**
 * Footnote or endnote references by their CP in the main document, each with its text range.
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 * @param {"footnote" | "endnote"} kind
 * @param {number} base where the notes' story starts
 * @returns {Map<number, NoteRef>}
 */
export function readNotes(table, fib, kind, base) {
  const r = new Reader(table);
  const refs = readPlc(table, fib.pair(kind === "footnote" ? PAIR.plcffndRef : PAIR.plcfendRef), 2);
  const texts = storyRanges(
    table,
    fib.pair(kind === "footnote" ? PAIR.plcffndTxt : PAIR.plcfendTxt),
    base,
  );
  /** @type {Map<number, NoteRef>} */
  const out = new Map();
  for (let i = 0; i + 1 < refs.cps.length; i++) {
    const text = texts[i];
    if (text)
      out.set(refs.cps[i] ?? 0, { cp: refs.cps[i] ?? 0, auto: r.i16(refs.data(i)) !== 0, text });
  }
  return out;
}

/**
 * Comments by the CP of their reference mark: author, date, text and the range they cover.
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 * @param {number} base where the comments' story starts
 * @returns {Map<number, CommentRef>}
 */
export function readComments(table, fib, base) {
  const r = new Reader(table);
  const refs = readPlc(table, fib.pair(PAIR.plcfandRef), 30);
  const texts = storyRanges(table, fib.pair(PAIR.plcfandTxt), base);
  // Authors: Xst strings (a 16-bit count, then UTF-16) one after another.
  /** @type {string[]} */
  const authors = [];
  const owners = fib.pair(PAIR.grpXstAtnOwners);
  for (let at = owners.fc; at + 2 <= owners.fc + owners.lcb && authors.length < 0xffff; ) {
    const cch = r.u16(at);
    let name = "";
    for (let i = 0; i < cch; i++) name += String.fromCharCode(r.u16(at + 2 + i * 2));
    authors.push(name);
    at += 2 + cch * 2;
  }
  // Ranges: SttbfAtnBkmk's lTag of each bookmark, its start (PlcfAtnBkf) and end (PlcfAtnBkl).
  /** @type {Map<number, [number, number]>} */
  const ranges = new Map();
  const bkmk = fib.pair(PAIR.sttbfAtnBkmk);
  if (bkmk.lcb >= 6 && r.u16(bkmk.fc) === 0xffff) {
    const starts = readPlc(table, fib.pair(PAIR.plcfAtnBkf), 4);
    const ends = readPlc(table, fib.pair(PAIR.plcfAtnBkl), 0);
    const count = r.u16(bkmk.fc + 2);
    for (let i = 0; i < count; i++) {
      const tag = r.u32(bkmk.fc + 6 + i * 12 + 4);
      const start = starts.cps[i];
      const end = ends.cps[r.u16(starts.data(i))];
      if (start !== undefined && end !== undefined) ranges.set(tag, [start, end]);
    }
  }
  const extra = fib.pair(PAIR.atrdExtra);
  /** @type {Map<number, CommentRef>} */
  const out = new Map();
  for (let i = 0; i + 1 < refs.cps.length; i++) {
    const at = refs.data(i);
    const text = texts[i];
    if (!text) continue;
    const comment = /** @type {CommentRef} */ ({
      cp: refs.cps[i] ?? 0,
      author: authors[r.i16(at + 20)] ?? "",
      date: extra.lcb >= (i + 1) * 18 ? dttm(r.u32(extra.fc + i * 18)) : "",
      text,
    });
    const range = ranges.get(r.u32(at + 26));
    if (r.i32(at + 26) !== -1 && range) comment.range = range;
    out.set(comment.cp, comment);
  }
  return out;
}

/** A DTTM ([MS-DOC] 2.9.65) as an ISO date, or "" when it says nothing. */
function dttm(/** @type {number} */ v) {
  const min = v & 0x3f;
  const hour = (v >> 6) & 0x1f;
  const day = (v >> 11) & 0x1f;
  const month = (v >> 16) & 0x0f;
  const year = 1900 + ((v >>> 20) & 0x1ff);
  if (!day || !month) return "";
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(min)}:00`;
}

/**
 * The text box stories by their 1-based index, and by the shape id (lid) each one begins in.
 * @param {Uint8Array} table
 * @param {import("./fib.js").FcLcb} at PlcftxbxTxt or PlcfHdrtxbxTxt
 * @param {number} base
 */
export function readBoxes(table, at, base) {
  const r = new Reader(table);
  const plc = readPlc(table, at, 22);
  /** @type {Array<[number, number]>} */
  const byIndex = [];
  /** @type {Map<number, [number, number]>} */
  const byShape = new Map();
  for (let i = 0; i + 2 < plc.cps.length; i++) {
    const range = /** @type {[number, number]} */ ([
      base + (plc.cps[i] ?? 0),
      base + (plc.cps[i + 1] ?? 0),
    ]);
    byIndex.push(range);
    if (!(r.u16(plc.data(i) + 8) & 1)) byShape.set(r.i32(plc.data(i) + 14), range);
  }
  return { byIndex, byShape };
}
