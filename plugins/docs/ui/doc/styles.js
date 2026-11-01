// The stylesheet ([MS-DOC] 2.9.271 STSH) and the font table (2.9.286 SttbfFfn). Each style's
// paragraph and character properties are its base style's with its own UPX applied on top
// (2.4.6.5); the defaults' fonts come from the STSHI. Character styles apply over a paragraph style.
import { decode, Reader } from "../bytes.js";
import { PAIR } from "./fib.js";
import { applyChp, applyPap, defaultChp, defaultPap } from "./props.js";

/**
 * @typedef {import("./props.js").Chp} Chp
 * @typedef {import("./props.js").Pap} Pap
 * @typedef {{ name: string, sti: number, stk: number, base: number, upx: { papx?: Uint8Array, chpx?: Uint8Array, tapx?: Uint8Array } }} Std
 * @typedef {{ name: string, sti: number, stk: number, pap: Pap, chp: Chp, tapx: Uint8Array[] }} Style
 */

const NONE = 0x0fff;

/**
 * The font names of SttbfFfn, by ftc.
 * @param {Uint8Array} table
 * @param {import("./fib.js").FcLcb} at
 */
export function readFonts(table, at) {
  const r = new Reader(table);
  /** @type {string[]} */
  const names = [];
  if (at.lcb < 4) return names;
  const extended = r.u16(at.fc) === 0xffff;
  let p = at.fc + (extended ? 2 : 0);
  const count = r.u16(p);
  p += 4;
  const end = at.fc + at.lcb;
  for (let i = 0; i < count && p < end; i++) {
    const size = r.u8(p);
    // FFN: ffid, wWeight, chs, ixchSzAlt, panose (10), fs (24), then the UTF-16 name.
    const from = p + 1 + 39;
    let to = from;
    while (to + 1 < p + 1 + size && r.u16(to) !== 0) to += 2;
    names.push(decode(table.subarray(from, to), "utf-16le"));
    p += 1 + size;
  }
  return names;
}

/**
 * @param {Uint8Array} table
 * @param {import("./fib.js").Fib} fib
 * @param {Uint8Array | undefined} data
 */
export function readStyles(table, fib, data) {
  const r = new Reader(table);
  const { fc, lcb } = fib.pair(PAIR.stshf);
  const cbStshi = r.u16(fc);
  const cstd = Math.min(r.u16(fc + 2), 4094);
  const baseSize = r.u16(fc + 4) || 10;
  const fonts = { ftcAsci: r.i16(fc + 14), ftcFE: r.i16(fc + 16), ftcOther: r.i16(fc + 18) };
  /** @type {Array<Std | undefined>} */
  const stds = [];
  let at = fc + 2 + cbStshi;
  const end = fc + lcb;
  for (let istd = 0; istd < cstd && at + 2 <= end; istd++) {
    const cb = r.u16(at);
    stds.push(cb ? readStd(table, at + 2, cb, baseSize) : undefined);
    at += 2 + cb + (cb & 1);
  }

  const defaults = defaultChp(fonts);
  /** @type {Map<number, Style>} */
  const resolved = new Map();
  /** @returns {Style} */
  const style = (/** @type {number} */ istd, depth = 0) => {
    const done = resolved.get(istd);
    if (done) return done;
    const std = stds[istd];
    const parent =
      std && std.base !== NONE && std.base !== istd && depth < 16
        ? style(std.base, depth + 1)
        : undefined;
    const pap = { ...(parent?.pap ?? defaultPap()) };
    const chp = { ...(parent?.chp ?? defaults) };
    if (std?.upx.papx) applyPap(pap, std.upx.papx, data);
    if (std?.upx.chpx) {
      const base = parent?.chp ?? defaults;
      applyChp(chp, std.upx.chpx, { style: base, plain: base, charStyle: () => base });
    }
    const out = {
      name: std?.name ?? "",
      sti: std?.sti ?? NONE,
      stk: std?.stk ?? 1,
      pap,
      chp,
      tapx: [...(parent?.tapx ?? []), ...(std?.upx.tapx ? [std.upx.tapx] : [])],
    };
    resolved.set(istd, out);
    return out;
  };

  /** The UPX chain of a character style, root first. */
  const chain = (/** @type {number} */ istd) => {
    /** @type {Uint8Array[]} */
    const out = [];
    let at = istd;
    for (let guard = 0; guard < 16 && at !== NONE; guard++) {
      const std = stds[at];
      if (std?.stk !== 2) break;
      if (std.upx.chpx) out.unshift(std.upx.chpx);
      at = std.base;
    }
    return out;
  };
  /** @type {Map<string, Chp>} */
  const charCache = new Map();

  return {
    fonts,
    /** The resolved style at `istd`; a missing one is the defaults. */
    style: (/** @type {number} */ istd) => style(stds[istd] ? istd : 0),
    /** A paragraph style's character properties with a character style applied. */
    charStyle(/** @type {number} */ paraIstd, /** @type {number} */ charIstd) {
      const key = `${paraIstd}:${charIstd}`;
      const done = charCache.get(key);
      if (done) return done;
      const plain = style(stds[paraIstd] ? paraIstd : 0).chp;
      const chp = { ...plain };
      for (const upx of chain(charIstd)) {
        const before = { ...chp };
        applyChp(chp, upx, { style: before, plain, charStyle: () => plain });
      }
      charCache.set(key, chp);
      return chp;
    },
  };
}

/**
 * One STD ([MS-DOC] 2.9.258): StdfBase, the name (Xstz), then the UPXs its kind has.
 * @param {Uint8Array} table
 * @param {number} at
 * @param {number} cb
 * @param {number} baseSize
 * @returns {Std}
 */
function readStd(table, at, cb, baseSize) {
  const r = new Reader(table);
  const end = at + cb;
  const sti = r.u16(at) & 0x0fff;
  const stk = r.u16(at + 2) & 0x000f;
  const base = r.u16(at + 2) >> 4;
  const nameAt = at + baseSize;
  const cch = r.u16(nameAt);
  const name = decode(table.subarray(nameAt + 2, nameAt + 2 + cch * 2), "utf-16le");
  let p = nameAt + 2 + cch * 2 + 2;
  const kinds =
    stk === 1
      ? ["papx", "chpx"]
      : stk === 2
        ? ["chpx"]
        : stk === 3
          ? ["tapx", "papx", "chpx"]
          : ["papx"];
  /** @type {Std["upx"]} */
  const upx = {};
  for (const kind of kinds) {
    if (p + 2 > end) break;
    const size = r.u16(p);
    const from = p + 2;
    // UpxPapx starts with the style's istd.
    const skip = kind === "papx" ? Math.min(2, size) : 0;
    upx[/** @type {"papx" | "chpx" | "tapx"} */ (kind)] = table.subarray(
      from + skip,
      Math.min(end, from + size),
    );
    p = from + size + (size & 1);
  }
  return { name: name.split(",")[0] ?? name, sti, stk, base, upx };
}

/** @typedef {ReturnType<typeof readStyles>} Styles */
