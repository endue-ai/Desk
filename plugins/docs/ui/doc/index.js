// Word 97-2003 (.doc, .dot), text only: the FIB, the piece table (CLX) for the main document's
// characters, and the paragraph properties (PAPX in FKP pages) for table cells, row ends and the
// style index of each paragraph, whose fixed slots 1 to 9 are the built-in headings.
import { decode, Reader } from "../bytes.js";
import { formatName } from "../formats.js";
import { DocError, documentOf, ENCRYPTED, paragraph, section, tabbed } from "../model.js";

/** @typedef {{ cp: number, end: number, fc: number, compressed: boolean }} Piece */

/**
 * @param {import("../cfb.js").Cfb} cfb
 * @param {string} format
 */
export function readDoc(cfb, format) {
  const wd = cfb.read("WordDocument");
  if (!wd || wd.length < 0x200)
    throw new DocError("This file is damaged: its WordDocument stream is missing.");
  const r = new Reader(wd);
  const ident = r.u16(0);
  const nFib = r.u16(2);
  if (ident !== 0xa5ec || nFib < 101)
    throw new DocError("Word 6 and Word 95 documents are not read in this version.");
  const flags = r.u16(0x0a);
  if (flags & 0x0100 || flags & 0x8000) throw new DocError(ENCRYPTED);
  const table = cfb.read(flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new DocError("This file is damaged: its table stream is missing.");

  // FibBase, then FibRgW (csw words), FibRgLw (cslw longs), then the (fc, lcb) pairs.
  const csw = r.u16(0x20);
  const lwAt = 0x22 + csw * 2 + 2;
  const cslw = r.u16(lwAt - 2);
  const pairsAt = lwAt + cslw * 4 + 2;
  const ccpText = r.u32(lwAt + 3 * 4);
  const pair = (/** @type {number} */ i) => ({
    fc: r.u32(pairsAt + i * 8),
    lcb: r.u32(pairsAt + i * 8 + 4),
  });

  const pieces = readPieces(table, pair(33));
  const chars = (/** @type {number} */ from, /** @type {number} */ to) => {
    let out = "";
    for (const piece of pieces) {
      const start = Math.max(from, piece.cp);
      const end = Math.min(to, piece.end);
      if (start >= end) continue;
      const offset = piece.fc + (start - piece.cp) * (piece.compressed ? 1 : 2);
      const length = (end - start) * (piece.compressed ? 1 : 2);
      out += decode(
        wd.subarray(offset, offset + length),
        piece.compressed ? "windows-1252" : "utf-16le",
      );
    }
    return out;
  };
  const fcOf = (/** @type {number} */ cp) => {
    const piece = pieces.find((p) => cp >= p.cp && cp < p.end);
    return piece ? piece.fc + (cp - piece.cp) * (piece.compressed ? 1 : 2) : -1;
  };
  const papx = createPapx(wd, table, pair(13));
  const hidden = hiddenRanges(wd, table, pair(12));
  const isHidden = (/** @type {number} */ fc) => {
    let lo = 0;
    let hi = hidden.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const range = /** @type {[number, number]} */ (hidden[mid]);
      if (fc < range[0]) hi = mid - 1;
      else if (fc >= range[1]) lo = mid + 1;
      else return true;
    }
    return false;
  };

  const text = chars(0, ccpText);
  /** @type {import("../model.js").Block[]} */
  const blocks = [];
  /** @type {import("../model.js").Table | null} */
  let open = null;
  /** @type {import("../model.js").Cell[]} */
  let cells = [];
  /** @type {import("../model.js").Block[]} */
  let cell = [];
  const closeTable = () => {
    if (open) blocks.push(open);
    open = null;
  };
  const field = /** @type {Array<"instr" | "result">} */ ([]);
  let line = "";
  for (let cp = 0; cp < text.length; cp++) {
    const ch = text[cp] ?? "";
    const code = ch.charCodeAt(0);
    if (code === 0x13) field.push("instr");
    else if (code === 0x14) field[field.length - 1] = "result";
    else if (code === 0x15) field.pop();
    else if (code === 0x0d || code === 0x07 || code === 0x0c) {
      const props = papx(fcOf(cp));
      const content = paragraph(
        lines(line),
        props.istd >= 1 && props.istd <= 6 ? { level: props.istd } : {},
      );
      line = "";
      if (props.inTable && code === 0x07 && props.ttp) {
        open ??= { type: "table", rows: [], borders: true };
        open.rows.push({ cells });
        cells = [];
      } else if (props.inTable) {
        if (code === 0x07) {
          cell.push(content);
          cells.push({ blocks: cell, colSpan: 1, rowSpan: 1 });
          cell = [];
        } else cell.push(content);
      } else {
        closeTable();
        if (props.breakBefore && blocks.length) blocks.push({ type: "pagebreak" });
        blocks.push(content);
        if (code === 0x0c) blocks.push({ type: "pagebreak" });
      }
    } else if (!field.includes("instr") && !(hidden.length && isHidden(fcOf(cp)))) {
      if (code === 0x09 || code === 0x0b || code >= 0x20) line += code === 0x1e ? "‑" : ch;
    }
  }
  closeTable();
  if (line) blocks.push(paragraph(lines(line)));
  return documentOf({
    format,
    formatName: formatName(format),
    textOnly: true,
    sections: [section({ blocks })],
  });
}

/** A paragraph's text with its line breaks (vertical tab) and tabs. */
const lines = (/** @type {string} */ text) =>
  text
    .split("\u000b")
    .flatMap((part, i) => [
      ...(i > 0 ? [/** @type {import("../model.js").Inline} */ ({ type: "linebreak" })] : []),
      ...tabbed(part),
    ]);

/**
 * The piece table: where each run of characters lives in the WordDocument stream, and whether
 * it is stored as 8-bit (compressed) or UTF-16.
 * @param {Uint8Array} table
 * @param {{ fc: number, lcb: number }} clx
 * @returns {Piece[]}
 */
function readPieces(table, clx) {
  const r = new Reader(table);
  let at = clx.fc;
  const end = clx.fc + clx.lcb;
  while (at < end && r.u8(at) === 1) at += 3 + r.i16(at + 1);
  if (r.u8(at) !== 2) throw new DocError("This file is damaged: its piece table is missing.");
  const lcb = r.u32(at + 1);
  const plc = at + 5;
  const n = Math.floor((lcb - 4) / 12);
  /** @type {Piece[]} */
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const cp = r.u32(plc + i * 4);
    const next = r.u32(plc + (i + 1) * 4);
    const raw = r.u32(plc + (n + 1) * 4 + i * 8 + 2);
    const compressed = (raw & 0x40000000) !== 0;
    const fc = raw & 0x3fffffff;
    pieces.push({ cp, end: next, fc: compressed ? fc / 2 : fc, compressed });
  }
  return pieces;
}

/**
 * Paragraph properties by the stream offset of a paragraph mark: in a table, a row end (TTP), and
 * the style index.
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {{ fc: number, lcb: number }} plc PlcBtePapx
 */
function createPapx(wd, table, plc) {
  const t = new Reader(table);
  const w = new Reader(wd);
  const n = plc.lcb >= 12 ? Math.floor((plc.lcb - 4) / 8) : 0;
  const none = { inTable: false, ttp: false, istd: 0, breakBefore: false };
  return (/** @type {number} */ fc) => {
    if (fc < 0 || n === 0) return none;
    let page = -1;
    for (let i = 0; i < n; i++) {
      if (fc >= t.u32(plc.fc + i * 4) && fc < t.u32(plc.fc + (i + 1) * 4)) {
        page = t.u32(plc.fc + (n + 1) * 4 + i * 4) & 0x3fffff;
        break;
      }
    }
    if (page < 0) return none;
    const base = page * 512;
    const crun = w.u8(base + 511);
    for (let j = 0; j < crun; j++) {
      if (fc < w.u32(base + j * 4) || fc >= w.u32(base + (j + 1) * 4)) continue;
      const offset = w.u8(base + (crun + 1) * 4 + j * 13) * 2;
      if (offset === 0) return none;
      const at = base + offset;
      let cb = w.u8(at);
      let start = at + 1;
      let size = cb * 2 - 1;
      if (cb === 0) {
        cb = w.u8(at + 1);
        start = at + 2;
        size = cb * 2;
      }
      return sprms(w, start, start + size);
    }
    return none;
  };
}

/**
 * The stream ranges of deleted revisions and hidden text, from the character properties (CHPX in
 * FKP pages): they are not part of the text a reader sees.
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {{ fc: number, lcb: number }} plc PlcBteChpx
 * @returns {Array<[number, number]>}
 */
function hiddenRanges(wd, table, plc) {
  const t = new Reader(table);
  const w = new Reader(wd);
  const n = plc.lcb >= 12 ? Math.floor((plc.lcb - 4) / 8) : 0;
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = (t.u32(plc.fc + (n + 1) * 4 + i * 4) & 0x3fffff) * 512;
    const crun = w.u8(base + 511);
    for (let j = 0; j < crun; j++) {
      const offset = w.u8(base + (crun + 1) * 4 + j) * 2;
      if (!offset) continue;
      const cb = w.u8(base + offset);
      let at = base + offset + 1;
      const end = at + cb;
      let gone = false;
      while (at + 2 <= end) {
        const sprm = w.u16(at);
        const spra = sprm >> 13;
        at += 2;
        if ((sprm === 0x0800 || sprm === 0x083c) && w.u8(at) & 1) gone = true;
        at += spra < 2 ? 1 : spra === 3 ? 4 : spra === 7 ? 3 : spra === 6 ? w.u8(at) + 1 : 2;
      }
      if (gone) out.push([w.u32(base + j * 4), w.u32(base + (j + 1) * 4)]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** The table and style facts in a PAPX's istd and grpprl. */
function sprms(/** @type {Reader} */ r, /** @type {number} */ start, /** @type {number} */ end) {
  const out = { inTable: false, ttp: false, istd: r.u16(start), breakBefore: false };
  let at = start + 2;
  while (at + 2 <= end) {
    const sprm = r.u16(at);
    const spra = sprm >> 13;
    at += 2;
    if (sprm === 0x2416 || sprm === 0x244b) out.inTable ||= r.u8(at) !== 0;
    if (sprm === 0x2417 || sprm === 0x244c) out.ttp ||= r.u8(at) !== 0;
    if (sprm === 0x6649 && r.u32(at) > 0) out.inTable = true;
    if (sprm === 0x2407) out.breakBefore = r.u8(at) !== 0;
    const size =
      spra === 0 || spra === 1
        ? 1
        : spra === 2 || spra === 4 || spra === 5
          ? 2
          : spra === 3
            ? 4
            : spra === 7
              ? 3
              : sprm === 0xd608
                ? r.u16(at) + 1
                : r.u8(at) + 1;
    at += size;
  }
  return out;
}
