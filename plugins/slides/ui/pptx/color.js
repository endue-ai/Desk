// DrawingML colours: sRGB, scheme (through the master's colour map), system, preset, HSL and scRGB,
// with their transforms (alpha, lumMod, lumOff, satMod, tint, shade, ...). The result is CSS.
import { attr, kids, num } from "../xml.js";

/**
 * @typedef {{
 *   scheme: Record<string, string>, map: Record<string, string>, phClr?: string
 * }} ColorContext  scheme: the theme's colours as rrggbb; map: bg1 -> lt1 and so on; phClr: the
 *   colour a style reference puts in place of phClr.
 */

const PRESET = /** @type {Record<string, string>} */ ({
  black: "000000",
  white: "ffffff",
  red: "ff0000",
  green: "008000",
  lime: "00ff00",
  blue: "0000ff",
  yellow: "ffff00",
  cyan: "00ffff",
  magenta: "ff00ff",
  gray: "808080",
  grey: "808080",
  ltGray: "d3d3d3",
  dkGray: "a9a9a9",
  silver: "c0c0c0",
  navy: "000080",
  dkBlue: "00008b",
  dkRed: "8b0000",
  dkGreen: "006400",
  orange: "ffa500",
  purple: "800080",
  brown: "a52a2a",
  pink: "ffc0cb",
  gold: "ffd700",
});

const COLOR_NAMES = ["srgbClr", "schemeClr", "sysClr", "prstClr", "hslClr", "scrgbClr"];

const clamp = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const toLinear = (/** @type {number} */ c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (/** @type {number} */ c) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/** @param {number} r @param {number} g @param {number} b  0..1 each */
function toHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

/** @param {number} h degrees @param {number} s @param {number} l */
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** @param {string} hex @returns {number[]} */
const rgbOf = (hex) => [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255 || 0);

/** @param {number[]} rgb @param {number} alpha */
export function cssOf(rgb, alpha = 1) {
  const [r, g, b] = rgb.map((c) => Math.round(clamp(c) * 255));
  if (alpha < 1) return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp(alpha) * 1000) / 1000})`;
  return `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

/** The base colour of one colour element, as 0..1 RGB. @param {Element} el @param {ColorContext} ctx */
function baseOf(el, ctx) {
  const val = attr(el, "val") ?? "";
  switch (el.localName) {
    case "srgbClr":
      return rgbOf(val);
    case "sysClr":
      return rgbOf(attr(el, "lastClr") ?? (val === "window" ? "ffffff" : "000000"));
    case "prstClr":
      return rgbOf(PRESET[val] ?? "000000");
    case "hslClr":
      return fromHsl(num(el, "hue") / 60000, num(el, "sat") / 100000, num(el, "lum") / 100000);
    case "scrgbClr":
      return ["r", "g", "b"].map((k) => toSrgb(clamp(num(el, k) / 100000)));
    default: {
      if (val === "phClr") return rgbOf(ctx.phClr ?? "000000");
      const name = ctx.map[val] ?? val;
      return rgbOf(ctx.scheme[name] ?? ctx.scheme[val] ?? "000000");
    }
  }
}

/** One colour element with its transforms, or null for an element that is not a colour. */
export function colorOf(
  /** @type {Element | null | undefined} */ el,
  /** @type {ColorContext} */ ctx,
) {
  if (!el || !COLOR_NAMES.includes(el.localName)) return null;
  let rgb = baseOf(el, ctx);
  let alpha = 1;
  for (const t of kids(el)) {
    const v = num(t, "val") / 100000;
    const name = t.localName;
    if (name === "alpha") alpha = v;
    else if (name === "alphaMod") alpha *= v;
    else if (name === "alphaOff") alpha += v;
    else if (name === "tint") rgb = rgb.map((c) => toSrgb(1 - (1 - toLinear(c)) * v));
    else if (name === "shade") rgb = rgb.map((c) => toSrgb(toLinear(c) * v));
    else if (name === "comp") rgb = rgb.map((c) => 1 - c);
    else if (name === "inv") rgb = rgb.map((c) => 1 - c);
    else if (name === "gray")
      rgb = Array(3).fill(0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0));
    else if (["lumMod", "lumOff", "satMod", "satOff", "hueMod", "hueOff"].includes(name)) {
      const hsl = toHsl(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0);
      if (name === "lumMod") hsl.l *= v;
      if (name === "lumOff") hsl.l += v;
      if (name === "satMod") hsl.s *= v;
      if (name === "satOff") hsl.s += v;
      if (name === "hueMod") hsl.h = (hsl.h * v) % 360;
      if (name === "hueOff") hsl.h = (hsl.h + num(t, "val") / 60000 + 360) % 360;
      rgb = fromHsl(hsl.h, clamp(hsl.s), clamp(hsl.l));
    }
  }
  return { rgb, alpha: clamp(alpha) };
}

/** The CSS of the first colour child of `parent` (a solidFill, a gs, ...), or null. */
export function childColor(
  /** @type {Element | null | undefined} */ parent,
  /** @type {ColorContext} */ ctx,
) {
  for (const el of kids(parent)) {
    const color = colorOf(el, ctx);
    if (color) return cssOf(color.rgb, color.alpha);
  }
  return null;
}

/** The rrggbb of the first colour child, for phClr, or undefined. */
export function childHex(
  /** @type {Element | null | undefined} */ parent,
  /** @type {ColorContext} */ ctx,
) {
  for (const el of kids(parent)) {
    const color = colorOf(el, ctx);
    if (color) return cssOf(color.rgb).slice(1);
  }
  return undefined;
}
