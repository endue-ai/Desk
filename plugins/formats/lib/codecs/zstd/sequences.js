// The sequences section (RFC 8878, 3.1.1.3.2): literal lengths, offsets and match lengths decoded
// from one backward bitstream with three FSE states, and executed against the window as they come.
import { damaged } from "../input.js";
import { BackBits } from "./bits.js";
import { LL_DEFAULT, ML_DEFAULT, OF_DEFAULT, readTable, rleTable } from "./fse.js";

/** @typedef {import("./fse.js").FseTable} FseTable */
/**
 * @typedef {{
 *   out: Uint8Array, len: number, window: number, rep: number[],
 *   tables: { ll?: FseTable, of?: FseTable, ml?: FseTable },
 * }} SequencesState
 * `out` holds the window: the frame's last bytes up to `len`, with room for one more block.
 */

const LL_BASE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128,
  256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
];
const LL_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12,
  13, 14, 15, 16,
];
const ML_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051,
  4099, 8195, 16387, 32771, 65539,
];
const ML_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];

const BLOCK_MAX = 128 * 1024;
const KINDS = /** @type {const} */ ([
  ["ll", LL_DEFAULT, 9, 35],
  ["of", OF_DEFAULT, 8, 31],
  ["ml", ML_DEFAULT, 9, 52],
]);

/**
 * Decode and execute the sequences at b[at..end) with the block's literals, appending the block's
 * output to state.out from state.len on; state.len moves to its end.
 * @param {Uint8Array} b @param {number} at @param {number} end @param {SequencesState} state
 * @param {Uint8Array} lit @param {number} litCount
 */
export function runSequences(b, at, end, state, lit, litCount) {
  const out = state.out;
  const blockStart = state.len;
  if (at >= end) throw damaged("Zstandard", "a block has no sequences section");
  const n0 = /** @type {number} */ (b[at]);
  let count = n0;
  let p = at + 1;
  if (n0 >= 255) {
    count = (b[at + 1] ?? 0) + ((b[at + 2] ?? 0) << 8) + 0x7f00;
    p = at + 3;
  } else if (n0 >= 128) {
    count = ((n0 - 128) << 8) + (b[at + 1] ?? 0);
    p = at + 2;
  }
  if (count === 0) {
    if (p !== end) throw damaged("Zstandard", "a block has data after its literals");
    out.set(lit.subarray(0, litCount), blockStart);
    state.len = blockStart + litCount;
    return;
  }
  if (p >= end) throw damaged("Zstandard", "a block's sequences are cut short");
  const modes = /** @type {number} */ (b[p++]);
  if (modes & 3) throw damaged("Zstandard", "a reserved bit is set");
  /** @type {FseTable[]} */
  const tables = [];
  for (let k = 0; k < 3; k++) {
    const [kind, predefined, maxLog, maxSymbol] = /** @type {(typeof KINDS)[number]} */ (KINDS[k]);
    const mode = (modes >> (6 - 2 * k)) & 3;
    let table;
    if (mode === 0) table = predefined;
    else if (mode === 1) {
      if (p >= end || /** @type {number} */ (b[p]) > maxSymbol)
        throw damaged("Zstandard", "a repeated symbol is out of range");
      table = rleTable(/** @type {number} */ (b[p++]));
    } else if (mode === 2) {
      const read = readTable(b, p, end, maxLog, maxSymbol);
      table = read.table;
      p += read.bytes;
    } else {
      table = state.tables[kind];
      if (!table) throw damaged("Zstandard", "a block reuses a table never given");
    }
    state.tables[kind] = table;
    tables.push(table);
  }
  const [ll, of, ml] = /** @type {[FseTable, FseTable, FseTable]} */ (tables);
  const bits = new BackBits(b, p, end);
  let lls = bits.read(ll.log);
  let ofs = bits.read(of.log);
  let mls = bits.read(ml.log);
  const rep = state.rep;
  let o = blockStart;
  const limit = blockStart + BLOCK_MAX;
  let litPos = 0;
  for (let i = 0; i < count; i++) {
    const ofCode = /** @type {number} */ (of.symbols[ofs]);
    const mlCode = /** @type {number} */ (ml.symbols[mls]);
    const llCode = /** @type {number} */ (ll.symbols[lls]);
    if (ofCode > 31) throw damaged("Zstandard", "an offset code is out of range");
    const value = ofCode === 0 ? 1 : 2 ** ofCode + bits.read(ofCode);
    const matchLength =
      /** @type {number} */ (ML_BASE[mlCode]) + bits.read(/** @type {number} */ (ML_BITS[mlCode]));
    const litLength =
      /** @type {number} */ (LL_BASE[llCode]) + bits.read(/** @type {number} */ (LL_BITS[llCode]));
    let offset;
    if (value > 3) {
      offset = value - 3;
      rep[2] = /** @type {number} */ (rep[1]);
      rep[1] = /** @type {number} */ (rep[0]);
      rep[0] = offset;
    } else {
      const index = value - 1 + (litLength === 0 ? 1 : 0);
      if (index === 0) offset = /** @type {number} */ (rep[0]);
      else {
        offset =
          index === 3 ? /** @type {number} */ (rep[0]) - 1 : /** @type {number} */ (rep[index]);
        if (offset <= 0) throw damaged("Zstandard", "a repeated offset is zero");
        if (index !== 1) rep[2] = /** @type {number} */ (rep[1]);
        rep[1] = /** @type {number} */ (rep[0]);
        rep[0] = offset;
      }
    }
    if (i + 1 < count) {
      lls = /** @type {number} */ (ll.base[lls]) + bits.read(/** @type {number} */ (ll.bits[lls]));
      mls = /** @type {number} */ (ml.base[mls]) + bits.read(/** @type {number} */ (ml.bits[mls]));
      ofs = /** @type {number} */ (of.base[ofs]) + bits.read(/** @type {number} */ (of.bits[ofs]));
    }
    if (litPos + litLength > litCount)
      throw damaged("Zstandard", "a sequence runs past the literals");
    if (o + litLength + matchLength > limit)
      throw damaged("Zstandard", "a block decodes past 128 KiB");
    if (litLength) {
      out.set(lit.subarray(litPos, litPos + litLength), o);
      o += litLength;
      litPos += litLength;
    }
    if (offset > o || offset > state.window)
      throw damaged("Zstandard", "a match points before the start of the data");
    const from = o - offset;
    if (offset >= matchLength) out.copyWithin(o, from, from + matchLength);
    else for (let k = 0; k < matchLength; k++) out[o + k] = /** @type {number} */ (out[from + k]);
    o += matchLength;
  }
  if (bits.pos !== 0) throw damaged("Zstandard", "the sequences do not end where they should");
  if (o + litCount - litPos > limit) throw damaged("Zstandard", "a block decodes past 128 KiB");
  out.set(lit.subarray(litPos, litCount), o);
  state.len = o + litCount - litPos;
}
