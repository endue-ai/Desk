// Property modifiers ([MS-DOC] 2.2.5): every list of properties in a Word 97 file is a grpprl, an
// array of Prl (a 2-byte sprm and its operand). The operand's size comes from the sprm's spra bits,
// with two exceptions that carry their own length. Prm0 ([MS-DOC] 2.9.215) packs one sprm into a
// piece descriptor by a 7-bit index.
import { Reader } from "../bytes.js";

/** @typedef {(sprm: number, r: Reader, at: number, size: number) => boolean | undefined} Visit */

/**
 * The size of a sprm's operand at `at`.
 * @param {Reader} r
 * @param {number} sprm
 * @param {number} at
 */
export function operandSize(r, sprm, at) {
  const spra = sprm >> 13;
  if (spra === 0 || spra === 1) return 1;
  if (spra === 2 || spra === 4 || spra === 5) return 2;
  if (spra === 3) return 4;
  if (spra === 7) return 3;
  // sprmTDefTable: a 2-byte count of the rest, incremented by one.
  if (sprm === 0xd608 || sprm === 0xd606) return r.u16(at) + 1;
  // sprmPChgTabs: 255 means "count the tabs" (PChgTabsDelClose, then PChgTabsAdd).
  if (sprm === 0xc615 && r.u8(at) === 255) {
    const del = r.u8(at + 1);
    const add = r.u8(at + 2 + del * 4);
    return 1 + 1 + del * 4 + 1 + add * 3;
  }
  return r.u8(at) + 1;
}

/**
 * Visit each Prl of a grpprl in order; a visit that returns true stops the walk.
 * @param {Uint8Array} grpprl
 * @param {Visit} visit
 */
export function eachSprm(grpprl, visit) {
  const r = new Reader(grpprl);
  let at = 0;
  while (at + 2 <= grpprl.length) {
    const sprm = r.u16(at);
    const size = operandSize(r, sprm, at + 2);
    if (at + 2 + size > grpprl.length) break;
    if (visit(sprm, r, at + 2, size)) break;
    at += 2 + size;
  }
}

/** The sprm of each Prm0 isprm; the operand is always one byte. */
const PRM0 = new Map([
  [0x04, 0x2602],
  [0x05, 0x2461],
  [0x07, 0x2405],
  [0x08, 0x2406],
  [0x09, 0x2407],
  [0x0c, 0x260a],
  [0x0d, 0x2470],
  [0x0e, 0x240c],
  [0x0f, 0x2471],
  [0x18, 0x2416],
  [0x19, 0x2417],
  [0x1d, 0x261b],
  [0x25, 0x2423],
  [0x2c, 0x242a],
  [0x32, 0x2430],
  [0x33, 0x2431],
  [0x35, 0x2433],
  [0x36, 0x2434],
  [0x37, 0x2435],
  [0x38, 0x2436],
  [0x39, 0x2437],
  [0x3a, 0x2438],
  [0x41, 0x0800],
  [0x42, 0x0801],
  [0x43, 0x0802],
  [0x47, 0x0806],
  [0x4b, 0x080a],
  [0x4d, 0x2a0c],
  [0x4e, 0x0858],
  [0x4f, 0x2859],
  [0x50, 0x0811],
  [0x51, 0x0818],
  [0x53, 0x2a33],
  [0x55, 0x0835],
  [0x56, 0x0836],
  [0x57, 0x0837],
  [0x58, 0x0838],
  [0x59, 0x0839],
  [0x5a, 0x083a],
  [0x5b, 0x083b],
  [0x5c, 0x083c],
  [0x5e, 0x2a3e],
  [0x62, 0x2a42],
  [0x68, 0x2a48],
  [0x73, 0x2a53],
  [0x74, 0x0854],
  [0x75, 0x0855],
  [0x76, 0x0856],
  [0x78, 0x2640],
  [0x7b, 0x2a90],
  [0x7c, 0x2a86],
  [0x7e, 0x2443],
]);

/**
 * A piece's Prm as a grpprl: Prm0 is one sprm, Prm1 an index into the CLX's Prc list.
 * @param {number} prm
 * @param {Uint8Array[]} prcs
 * @returns {Uint8Array | null}
 */
export function prmGrpprl(prm, prcs) {
  if (prm & 1) return prcs[prm >> 1] ?? null;
  const sprm = PRM0.get((prm >> 1) & 0x7f);
  const value = prm >> 8;
  if (!sprm) return null;
  return Uint8Array.of(sprm & 0xff, sprm >> 8, value);
}
