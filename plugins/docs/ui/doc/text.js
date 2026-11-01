// The text of a Word 97 file ([MS-DOC] 2.4.1, 2.4.6.1, 2.4.6.2): the piece table in the CLX with
// each piece's Prm, characters by CP (8-bit pieces in Windows-1252, the rest UTF-16), and the CHPX
// and PAPX runs of the FKP pages, found by stream offset (FC).
import { Reader } from "../bytes.js";
import { DocError } from "../model.js";
import { PAIR, readPlc } from "./fib.js";
import { prmGrpprl } from "./sprm.js";

/**
 * @typedef {{ cp: number, end: number, fc: number, wide: boolean, prm: Uint8Array | null }} Piece
 * @typedef {{ fc: number, end: number, grpprl: Uint8Array, istd: number }} Run
 * @typedef {{ cp: number, end: number, chpx: Uint8Array | null, prm: Uint8Array | null }} Segment
 */

const EMPTY = new Uint8Array(0);
const ansi = new TextDecoder("windows-1252");
const wide = new TextDecoder("utf-16le", { ignoreBOM: true });

/**
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 */
export function readText(wd, table, fib) {
  const pieces = readPieces(wd, table, fib.pair(PAIR.clx));
  const last = pieces.at(-1)?.end ?? 0;
  const chpx = readFkps(wd, table, fib.pair(PAIR.plcfBteChpx), false);
  const papx = readFkps(wd, table, fib.pair(PAIR.plcfBtePapx), true);

  /** The piece holding `cp`, or undefined past the end. */
  const pieceAt = (/** @type {number} */ cp) => {
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const piece = /** @type {Piece} */ (pieces[mid]);
      if (cp < piece.cp) hi = mid - 1;
      else if (cp >= piece.end) lo = mid + 1;
      else return piece;
    }
    return undefined;
  };
  const fcOf = (/** @type {number} */ cp) => {
    const piece = pieceAt(cp);
    return piece ? piece.fc + (cp - piece.cp) * (piece.wide ? 2 : 1) : -1;
  };

  return {
    /** The characters of [from, to), one string unit per CP. */
    chars(/** @type {number} */ from, /** @type {number} */ to) {
      // No story holds more characters than the stream has bytes.
      const stop = Math.min(to, last, from + wd.length);
      let out = "";
      for (const piece of pieces) {
        const start = Math.max(from, piece.cp);
        const end = Math.min(stop, piece.end);
        if (start >= end) continue;
        if (out.length < start - from) out = out.padEnd(start - from, "\u0000");
        const width = piece.wide ? 2 : 1;
        const at = piece.fc + (start - piece.cp) * width;
        const bytes = wd.subarray(at, at + (end - start) * width);
        const text = (piece.wide ? wide : ansi).decode(bytes);
        // A piece cut short by a damaged file still keeps CPs and string indexes aligned.
        out += text.length < end - start ? text.padEnd(end - start, "\u0000") : text;
      }
      return out.padEnd(Math.max(0, stop - from), "\u0000");
    },
    fcOf,
    pieceAt,
    /** The paragraph properties of the paragraph whose mark is at `cp`. */
    papxAt(/** @type {number} */ cp) {
      const run = find(papx, fcOf(cp));
      const prm = pieceAt(cp)?.prm ?? null;
      return { istd: run?.istd ?? 0, grpprl: run?.grpprl ?? EMPTY, prm };
    },
    /**
     * [from, to) cut where the piece or the CHPX run changes, each with its direct properties.
     * @returns {Segment[]}
     */
    segments(/** @type {number} */ from, /** @type {number} */ to) {
      /** @type {Segment[]} */
      const out = [];
      for (const piece of pieces) {
        let cp = Math.max(from, piece.cp);
        const end = Math.min(to, piece.end);
        const width = piece.wide ? 2 : 1;
        while (cp < end) {
          const fc = piece.fc + (cp - piece.cp) * width;
          const run = find(chpx, fc);
          const next = runEnd(chpx, run, fc);
          const stop = Math.min(end, piece.cp + Math.ceil((next - piece.fc) / width));
          const limit = stop > cp ? stop : cp + 1;
          out.push({ cp, end: limit, chpx: run?.grpprl ?? null, prm: piece.prm });
          cp = limit;
        }
      }
      return out;
    },
  };
}

/** The run whose [fc, end) holds `fc`. @param {Run[]} runs @param {number} fc */
function find(runs, fc) {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = /** @type {Run} */ (runs[mid]);
    if (fc < run.fc) hi = mid - 1;
    else if (fc >= run.end) lo = mid + 1;
    else return run;
  }
  return undefined;
}

/** Where the formatting at `fc` stops: its run's end, or the next run's start. */
function runEnd(/** @type {Run[]} */ runs, /** @type {Run | undefined} */ run, fc = 0) {
  if (run) return run.end;
  const next = runs.find((r) => r.fc > fc);
  return next ? next.fc : Number.MAX_SAFE_INTEGER;
}

/**
 * The piece table: the CLX's Prc list (grpprls the pieces' Prm1 point to), then the PlcPcd. A
 * piece is cut where the stream ends, and pieces that go back or overlap are left out.
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {import("./fib.js").FcLcb} clx
 * @returns {Piece[]}
 */
function readPieces(wd, table, clx) {
  const r = new Reader(table);
  let at = clx.fc;
  const end = Math.min(table.length, clx.fc + clx.lcb);
  /** @type {Uint8Array[]} */
  const prcs = [];
  while (at < end && r.u8(at) === 1) {
    const size = Math.max(0, r.i16(at + 1));
    prcs.push(table.subarray(at + 3, at + 3 + size));
    at += 3 + size;
  }
  if (r.u8(at) !== 2) throw new DocError("This file is damaged: its piece table is missing.");
  const plc = readPlc(table, { fc: at + 5, lcb: r.u32(at + 1) }, 8);
  /** @type {Piece[]} */
  const pieces = [];
  for (let i = 0; i + 1 < plc.cps.length; i++) {
    const cp = plc.cps[i] ?? 0;
    const raw = r.u32(plc.data(i) + 2);
    const compressed = (raw & 0x40000000) !== 0;
    const fc = compressed ? (raw & 0x3fffffff) / 2 : raw & 0x3fffffff;
    const room = Math.max(0, Math.floor((wd.length - fc) / (compressed ? 1 : 2)));
    const next = Math.min(plc.cps[i + 1] ?? 0, cp + room);
    if (next <= cp || cp < (pieces.at(-1)?.end ?? 0)) continue;
    pieces.push({
      cp,
      end: next,
      fc,
      wide: !compressed,
      prm: prmGrpprl(r.u16(plc.data(i) + 6), prcs),
    });
  }
  if (pieces.length === 0) throw new DocError("This file is damaged: its piece table is empty.");
  return pieces;
}

/**
 * Every run of the CHPX or PAPX FKP pages a PlcBte lists, sorted by stream offset.
 * @param {Uint8Array} wd
 * @param {Uint8Array} table
 * @param {import("./fib.js").FcLcb} plcBte
 * @param {boolean} paragraphs
 * @returns {Run[]}
 */
function readFkps(wd, table, plcBte, paragraphs) {
  const t = new Reader(table);
  const w = new Reader(wd);
  const plc = readPlc(table, plcBte, 4);
  /** @type {Run[]} */
  const runs = [];
  /** @type {Set<number>} */
  const seen = new Set();
  for (let i = 0; i + 1 < plc.cps.length; i++) {
    const page = t.u32(plc.data(i)) & 0x3fffff;
    if (seen.has(page)) continue;
    seen.add(page);
    const base = page * 512;
    if (base + 512 > wd.length) continue;
    const count = w.u8(base + 511);
    for (let j = 0; j < count; j++) {
      const fc = w.u32(base + j * 4);
      const end = w.u32(base + (j + 1) * 4);
      if (end <= fc) continue;
      const entry = base + (count + 1) * 4 + j * (paragraphs ? 13 : 1);
      const offset = w.u8(entry) * 2;
      if (!paragraphs) {
        const size = offset ? w.u8(base + offset) : 0;
        const at = base + offset + 1;
        runs.push({ fc, end, grpprl: offset ? wd.subarray(at, at + size) : EMPTY, istd: 0 });
        continue;
      }
      if (!offset) {
        runs.push({ fc, end, grpprl: EMPTY, istd: 0 });
        continue;
      }
      // PapxInFkp: cb, or 0 and cb', then the istd and the grpprl.
      const cb = w.u8(base + offset);
      const start = cb ? base + offset + 1 : base + offset + 2;
      const size = cb ? cb * 2 - 1 : w.u8(base + offset + 1) * 2;
      runs.push({
        fc,
        end,
        istd: w.u16(start),
        grpprl: wd.subarray(start + 2, Math.min(base + 511, start + size)),
      });
    }
  }
  return runs.sort((a, b) => a.fc - b.fc);
}
