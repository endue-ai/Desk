// The File Information Block ([MS-DOC] 2.5): the version, the flags, the length of each story and
// the (fc, lcb) pairs that place every structure in the table stream. Word 6 and Word 95 files have
// another FIB and are refused here.
import { Reader } from "../bytes.js";
import { DocError, ENCRYPTED } from "../model.js";

/** FibRgFcLcb pair indexes ([MS-DOC] 2.5.6 to 2.5.8). */
export const PAIR = /** @type {const} */ ({
  stshf: 1,
  plcffndRef: 2,
  plcffndTxt: 3,
  plcfandRef: 4,
  plcfandTxt: 5,
  plcfSed: 6,
  plcfHdd: 11,
  plcfBteChpx: 12,
  plcfBtePapx: 13,
  sttbfFfn: 15,
  clx: 33,
  grpXstAtnOwners: 36,
  sttbfAtnBkmk: 37,
  plcSpaMom: 40,
  plcSpaHdr: 41,
  plcfAtnBkf: 42,
  plcfAtnBkl: 43,
  plcfendRef: 46,
  plcfendTxt: 47,
  dggInfo: 50,
  plcftxbxTxt: 56,
  plcfHdrtxbxTxt: 58,
  plfLst: 73,
  plfLfo: 74,
  atrdExtra: 112,
});

/**
 * @typedef {{ fc: number, lcb: number }} FcLcb
 * @typedef {{ text: number, ftn: number, hdd: number, mcr: number, atn: number, edn: number, txbx: number, hdrTxbx: number }} Ccp
 * @typedef {{ nFib: number, flags: number, tableName: string, ccp: Ccp, pair: (i: number) => FcLcb }} Fib
 */

/** @param {Uint8Array} wd the WordDocument stream @returns {Fib} */
export function readFib(wd) {
  const r = new Reader(wd);
  const ident = r.u16(0);
  const nFib = r.u16(2);
  if (ident !== 0xa5ec || nFib < 0xc0)
    throw new DocError("Word 6 and Word 95 documents are not read in this version.");
  const flags = r.u16(0x0a);
  if (flags & 0x0100 || flags & 0x8000) throw new DocError(ENCRYPTED);

  // FibBase (32 bytes), csw and FibRgW, cslw and FibRgLw, cbRgFcLcb and the pairs.
  const csw = r.u16(0x20);
  const cslwAt = 0x22 + csw * 2;
  const cslw = r.u16(cslwAt);
  const lwAt = cslwAt + 2;
  const countAt = lwAt + cslw * 4;
  const count = r.u16(countAt);
  const pairsAt = countAt + 2;
  const lw = (/** @type {number} */ i) => (i < cslw ? Math.max(0, r.i32(lwAt + i * 4)) : 0);
  return {
    nFib,
    flags,
    tableName: flags & 0x0200 ? "1Table" : "0Table",
    ccp: {
      text: lw(3),
      ftn: lw(4),
      hdd: lw(5),
      mcr: lw(6),
      atn: lw(7),
      edn: lw(8),
      txbx: lw(9),
      hdrTxbx: lw(10),
    },
    pair: (i) =>
      i < count
        ? { fc: r.u32(pairsAt + i * 8), lcb: r.u32(pairsAt + i * 8 + 4) }
        : { fc: 0, lcb: 0 },
  };
}

/**
 * The CPs of a PLC: n + 1 positions, then n data elements of `size` bytes each.
 * @param {Uint8Array} table
 * @param {FcLcb} at
 * @param {number} size
 * @returns {{ cps: number[], data: (i: number) => number }}
 */
export function readPlc(table, at, size) {
  if (at.lcb < 4 || at.fc + at.lcb > table.length) return { cps: [], data: () => -1 };
  const r = new Reader(table);
  const n = Math.floor((at.lcb - 4) / (4 + size));
  const cps = [];
  for (let i = 0; i <= n; i++) cps.push(r.i32(at.fc + i * 4));
  const base = at.fc + (n + 1) * 4;
  return { cps, data: (i) => base + i * size };
}
