// Character and paragraph properties ([MS-DOC] 2.6.1, 2.6.2): their defaults, and what each sprm of
// a grpprl changes. A toggle (0x80, 0x81) takes, or inverts, the value the style gives. Colours are
// the 16-entry Ico palette or a COLORREF; shading blends the pattern's colours.
import { Reader } from "../bytes.js";
import { eachSprm } from "./sprm.js";

/**
 * @typedef {{
 *   bold: boolean, italic: boolean, strike: boolean, caps: boolean, vanish: boolean,
 *   deleted: boolean, spec: boolean, data: boolean, ole2: boolean,
 *   kul: number, ico: number, cv: string | undefined, hps: number, iss: number,
 *   highlight: number, shd: string | undefined, ftc0: number, ftc1: number, ftc2: number,
 *   pic: number, symbol: { ftc: number, char: number } | undefined
 * }} Chp
 * @typedef {{
 *   jc?: number, left?: number, right?: number, first?: number, before?: number, after?: number,
 *   beforeAuto?: boolean, afterAuto?: boolean, line?: number, lineMult?: boolean,
 *   keepNext: boolean, breakBefore: boolean, outline: number, ilfo: number, ilvl: number,
 *   inTable: boolean, ttp: boolean, itap?: number, dtap: number, innerCell: boolean,
 *   innerTtp: boolean, bidi: boolean
 * }} Pap
 * @typedef {{ style: Chp, plain: Chp, charStyle: (istd: number) => Chp }} ChpEnv
 *   style: the values toggles refer to; plain: the paragraph style's; charStyle: plain with a
 *   character style applied.
 */

/** The Ico palette ([MS-DOC] 2.9.119); 0 is auto. */
export const ICO = [
  undefined,
  "#000000",
  "#0000FF",
  "#00FFFF",
  "#00FF00",
  "#FF00FF",
  "#FF0000",
  "#FFFF00",
  "#FFFFFF",
  "#000080",
  "#008080",
  "#008000",
  "#800080",
  "#800000",
  "#808000",
  "#808080",
  "#C0C0C0",
];

const hex = (/** @type {number} */ n) => n.toString(16).padStart(2, "0").toUpperCase();

/** A COLORREF (red, green, blue, then 0xFF for auto) as "#RRGGBB", or undefined for auto. */
export const colorRef = (/** @type {Reader} */ r, /** @type {number} */ at) =>
  r.u8(at + 3) === 0xff ? undefined : `#${hex(r.u8(at))}${hex(r.u8(at + 1))}${hex(r.u8(at + 2))}`;

/** The share of the foreground colour in each Ipat percentage pattern ([MS-DOC] 2.9.121). */
const PERCENT = /** @type {Record<number, number>} */ ({
  2: 5,
  3: 10,
  4: 20,
  5: 25,
  6: 30,
  7: 40,
  8: 50,
  9: 60,
  10: 70,
  11: 75,
  12: 80,
  13: 90,
});
[2.5, 7.5, 12.5, 15, 17.5, 22.5, 27.5, 32.5, 35, 37.5, 42.5, 45, 47.5, 52.5, 55, 57.5, 62.5, 65]
  .concat([67.5, 72.5, 77.5, 82.5, 85, 87.5, 92.5, 95, 97.5])
  .forEach((share, i) => {
    PERCENT[0x23 + i] = share;
  });

/**
 * The colour a shading shows: the background when clear, the foreground when solid, a blend for
 * a percentage; undefined when nothing is shaded.
 * @param {string | undefined} fore
 * @param {string | undefined} back
 * @param {number} ipat
 */
export function shading(fore, back, ipat) {
  if (ipat === 0xffff) return undefined;
  if (ipat === 0) return back;
  if (ipat === 1) return fore ?? "#000000";
  const share = PERCENT[ipat];
  if (share === undefined) return back ?? fore;
  const f = Number.parseInt((fore ?? "#000000").slice(1), 16);
  const b = Number.parseInt((back ?? "#FFFFFF").slice(1), 16);
  const mix = (/** @type {number} */ shift) =>
    Math.round((((f >> shift) & 255) * share + ((b >> shift) & 255) * (100 - share)) / 100);
  return `#${hex(mix(16))}${hex(mix(8))}${hex(mix(0))}`;
}

/** A Shd80 ([MS-DOC] 2.9.248): five bits of foreground, five of background, six of pattern. */
export const shd80 = (/** @type {number} */ value) =>
  value === 0xffff
    ? undefined
    : shading(ICO[value & 0x1f], ICO[(value >> 5) & 0x1f], (value >> 10) & 0x3f);

/** A Shd ([MS-DOC] 2.9.247): two COLORREFs and an Ipat. */
export const shd = (/** @type {Reader} */ r, /** @type {number} */ at) =>
  shading(colorRef(r, at), colorRef(r, at + 4), r.u16(at + 8));

/** @param {{ ftcAsci: number, ftcFE: number, ftcOther: number }} fonts @returns {Chp} */
export const defaultChp = (fonts) => ({
  bold: false,
  italic: false,
  strike: false,
  caps: false,
  vanish: false,
  deleted: false,
  spec: false,
  data: false,
  ole2: false,
  kul: 0,
  ico: 0,
  cv: undefined,
  hps: 20,
  iss: 0,
  highlight: 0,
  shd: undefined,
  ftc0: fonts.ftcAsci,
  ftc1: fonts.ftcFE,
  ftc2: fonts.ftcOther,
  pic: -1,
  symbol: undefined,
});

/** @returns {Pap} */
export const defaultPap = () => ({
  keepNext: false,
  breakBefore: false,
  outline: 9,
  ilfo: 0,
  ilvl: 0,
  inTable: false,
  ttp: false,
  dtap: 0,
  innerCell: false,
  innerTtp: false,
  bidi: false,
});

/** Toggle sprms and the property each sets. */
/** @type {Map<number, keyof Chp>} */
const TOGGLES = new Map([
  [0x0835, "bold"],
  [0x0836, "italic"],
  [0x0837, "strike"],
  [0x2a53, "strike"],
  [0x083a, "caps"],
  [0x083b, "caps"],
  [0x083c, "vanish"],
  [0x0800, "deleted"],
  [0x0855, "spec"],
  [0x0806, "data"],
  [0x080a, "ole2"],
]);

/** What sprmCIstd and sprmCPlain keep: revision marks and the special-character facts. */
const KEPT = /** @type {const} */ (["deleted", "spec", "data", "ole2", "pic", "symbol"]);

/**
 * Apply the character sprms of a grpprl to `chp`.
 * @param {Chp} chp
 * @param {Uint8Array | null} grpprl
 * @param {ChpEnv} env
 */
export function applyChp(chp, grpprl, env) {
  if (!grpprl?.length) return;
  const reset = (/** @type {Chp} */ to) => {
    const kept = KEPT.map((k) => chp[k]);
    Object.assign(chp, to);
    KEPT.forEach((k, i) => {
      Object.assign(chp, { [k]: kept[i] });
    });
    env.style = to;
  };
  eachSprm(grpprl, (sprm, r, at) => {
    const toggle = TOGGLES.get(sprm);
    if (toggle) {
      const v = r.u8(at);
      const styled = Boolean(env.style[toggle]);
      Object.assign(chp, { [toggle]: v === 0x80 ? styled : v === 0x81 ? !styled : v !== 0 });
      return;
    }
    switch (sprm) {
      case 0x4a30:
        reset(env.charStyle(r.u16(at)));
        break;
      case 0x2a33:
        reset(env.plain);
        break;
      case 0x2a3e:
        chp.kul = r.u8(at);
        break;
      case 0x2a42:
        chp.ico = r.u8(at);
        chp.cv = undefined;
        break;
      case 0x6870:
        chp.cv = colorRef(r, at);
        break;
      case 0x4a43:
        chp.hps = r.u16(at) || chp.hps;
        break;
      case 0x2a48:
        chp.iss = r.u8(at);
        break;
      case 0x2a0c:
        chp.highlight = r.u8(at);
        break;
      case 0x4866:
        chp.shd = shd80(r.u16(at));
        break;
      case 0xca71:
        chp.shd = shd(r, at + 1);
        break;
      case 0x4a4f:
        chp.ftc0 = r.u16(at);
        break;
      case 0x4a50:
        chp.ftc1 = r.u16(at);
        break;
      case 0x4a51:
        chp.ftc2 = r.u16(at);
        break;
      case 0x6a03:
        chp.pic = r.i32(at);
        break;
      case 0x6a09:
        chp.symbol = { ftc: r.u16(at), char: r.u16(at + 2) };
        break;
    }
  });
}

/**
 * Apply the paragraph sprms of a grpprl to `pap`. sprmPHugePapx moves the rest of the list to the
 * Data stream.
 * @param {Pap} pap
 * @param {Uint8Array | null} grpprl
 * @param {Uint8Array | undefined} data the Data stream
 * @param {number} [depth]
 */
export function applyPap(pap, grpprl, data, depth = 0) {
  if (!grpprl?.length) return;
  eachSprm(grpprl, (sprm, r, at) => {
    switch (sprm) {
      case 0x2403:
      case 0x2461:
        pap.jc = r.u8(at);
        break;
      case 0x840f:
      case 0x845e:
        pap.left = r.i16(at);
        break;
      case 0x840e:
      case 0x845d:
        pap.right = r.i16(at);
        break;
      case 0x8411:
      case 0x8460:
        pap.first = r.i16(at);
        break;
      case 0x4610:
      case 0x465f:
        pap.left = (pap.left ?? 0) + r.i16(at);
        break;
      case 0xa413:
        pap.before = r.u16(at);
        break;
      case 0xa414:
        pap.after = r.u16(at);
        break;
      case 0x245b:
        pap.beforeAuto = r.u8(at) !== 0;
        break;
      case 0x245c:
        pap.afterAuto = r.u8(at) !== 0;
        break;
      case 0x6412:
        pap.line = r.i16(at);
        pap.lineMult = r.i16(at + 2) === 1;
        break;
      case 0x2406:
        pap.keepNext = r.u8(at) !== 0;
        break;
      case 0x2407:
        pap.breakBefore = r.u8(at) !== 0;
        break;
      case 0x2640:
        pap.outline = r.u8(at);
        break;
      case 0x460b: {
        const ilfo = r.i16(at);
        pap.ilfo = ilfo === -2047 ? 0 : Math.abs(ilfo);
        break;
      }
      case 0x260a:
        pap.ilvl = Math.min(8, r.u8(at));
        break;
      case 0x2416:
        pap.inTable = r.u8(at) !== 0;
        break;
      case 0x2417:
        pap.ttp = r.u8(at) !== 0;
        break;
      case 0x6649:
        pap.itap = Math.max(0, r.i32(at));
        break;
      case 0x664a:
        pap.dtap += r.i32(at);
        break;
      case 0x244b:
        pap.innerCell = r.u8(at) !== 0;
        break;
      case 0x244c:
        pap.innerTtp = r.u8(at) !== 0;
        break;
      case 0x2441:
        pap.bidi = r.u8(at) !== 0;
        break;
      case 0x6646: {
        if (!data || depth > 4) return true;
        const d = new Reader(data);
        const fc = r.u32(at);
        applyPap(pap, data.subarray(fc + 2, fc + 2 + Math.max(0, d.i16(fc))), data, depth + 1);
        return true;
      }
    }
    return false;
  });
}

/** The table depth of a paragraph ([MS-DOC] 2.4.3); a damaged file nests at most 32 deep. */
export const depthOf = (/** @type {Pap} */ pap) =>
  Math.min(32, Math.max(0, (pap.itap ?? (pap.inTable ? 1 : 0)) + pap.dtap));
