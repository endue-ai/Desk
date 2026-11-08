// A DrawingML theme: its colour scheme, its major and minor fonts, and the fill, line and background
// styles that p:style references (fillRef, lnRef, bgRef) pick by index.
import { attr, kid, kids, path } from "../xml.js";

/**
 * @typedef {{
 *   scheme: Record<string, string>,
 *   fonts: { major: Record<string, string>, minor: Record<string, string> },
 *   fills: Element[], lines: Element[], backgrounds: Element[]
 * }} Theme
 */

/** @type {Theme} */
export const EMPTY_THEME = {
  scheme: { dk1: "000000", lt1: "ffffff", dk2: "1f497d", lt2: "eeece1", accent1: "4f81bd" },
  fonts: { major: { latin: "" }, minor: { latin: "" } },
  fills: [],
  lines: [],
  backgrounds: [],
};

/** @param {Element} root  a:theme */
export function readTheme(root) {
  const elements = kid(root, "themeElements");
  /** @type {Record<string, string>} */
  const scheme = {};
  for (const slot of kids(kid(elements, "clrScheme"))) {
    const color = kid(slot, "srgbClr", "sysClr");
    if (!color) continue;
    scheme[slot.localName] = (
      color.localName === "sysClr"
        ? (attr(color, "lastClr") ?? "000000")
        : (attr(color, "val") ?? "000000")
    ).toLowerCase();
  }
  const fontsOf = (/** @type {string} */ which) => {
    const font = path(elements, "fontScheme", which);
    /** @type {Record<string, string>} */
    const out = {};
    for (const script of ["latin", "ea", "cs"])
      out[script] = attr(kid(font, script), "typeface") ?? "";
    return out;
  };
  const fmt = kid(elements, "fmtScheme");
  return {
    scheme: { ...EMPTY_THEME.scheme, ...scheme },
    fonts: { major: fontsOf("majorFont"), minor: fontsOf("minorFont") },
    fills: kids(kid(fmt, "fillStyleLst")),
    lines: kids(kid(fmt, "lnStyleLst")),
    backgrounds: kids(kid(fmt, "bgFillStyleLst")),
  };
}

/**
 * A typeface, with the theme's +mj-lt / +mn-ea style references resolved.
 * @param {string | null} typeface
 * @param {Theme} theme
 */
export function fontOf(typeface, theme) {
  if (!typeface) return "";
  const ref = /^\+(mj|mn)-(lt|ea|cs)$/.exec(typeface);
  if (!ref) return typeface;
  const fonts = ref[1] === "mj" ? theme.fonts.major : theme.fonts.minor;
  const script = ref[2] === "lt" ? "latin" : (ref[2] ?? "latin");
  return fonts[script] || fonts.latin || "";
}
