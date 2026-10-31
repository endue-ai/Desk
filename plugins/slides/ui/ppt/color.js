// Colours of PowerPoint 97-2003 files: the slide colour scheme ([MS-PPT] SlideSchemeColorSchemeAtom),
// text colours (ColorIndexStruct) and OfficeArt colours ([MS-ODRAW] OfficeArtCOLORREF) with their
// scheme indexes, references to the shape's own colours and the changes they carry. No DOM.

/**
 * @typedef {import("./records.js").PptRecord} PptRecord
 * @typedef {{ scheme: string[], fill?: number[], line?: number[], back?: number[] }} ColorContext
 *   scheme: the eight scheme colours (background, text, shadow, title text, fill, accent 1-3);
 *   fill, line, back: the shape's own fill, line and fill background colours as 0..255 RGB.
 */

/** PowerPoint's default scheme. */
export const DEFAULT_SCHEME = [
  "#ffffff",
  "#000000",
  "#808080",
  "#000000",
  "#bbe0e3",
  "#333399",
  "#009999",
  "#99cc00",
];

const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(255, Math.round(v)));

/** 0..255 RGB as CSS, with an opacity under 1 as rgba(). @param {number[]} rgb */
export function css(rgb, alpha = 1) {
  const [r = 0, g = 0, b = 0] = rgb.map(clamp);
  if (alpha < 1) return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.max(0, alpha) * 1000) / 1000})`;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** "#rrggbb" as 0..255 RGB. @param {string} hex */
export const rgbOf = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) || 0);

/** The eight colours of a colour scheme atom, or null. @param {Uint8Array} b @param {PptRecord | null} rec */
export function schemeOf(b, rec) {
  if (!rec || rec.len < 32) return null;
  return Array.from({ length: 8 }, (_, i) =>
    css([b[rec.body + i * 4] ?? 0, b[rec.body + i * 4 + 1] ?? 0, b[rec.body + i * 4 + 2] ?? 0]),
  );
}

/**
 * A ColorIndexStruct (red, green, blue, index; read as one little-endian number) as CSS, or null
 * when it is undefined.
 * @param {number} value @param {string[]} scheme
 */
export function indexColor(value, scheme) {
  const index = value >>> 24;
  if (index === 0xfe) return css([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]);
  if (index < 8) return scheme[index] ?? null;
  return null;
}

/** Windows system colours an OfficeArtCOLORREF may name (GetSysColor indexes). */
const SYSTEM = /** @type {Record<number, number[]>} */ ({
  0: [200, 200, 200],
  1: [0, 0, 0],
  4: [240, 240, 240],
  5: [255, 255, 255],
  6: [100, 100, 100],
  7: [0, 0, 0],
  8: [0, 0, 0],
  15: [240, 240, 240],
  16: [160, 160, 160],
  18: [0, 0, 0],
});

/**
 * An OfficeArtCOLORREF as 0..255 RGB, or null when it is to be ignored.
 * @param {number} value @param {ColorContext} ctx @returns {number[] | null}
 */
export function colorRef(value, ctx) {
  const flags = value >>> 24;
  const red = value & 0xff;
  const green = (value >>> 8) & 0xff;
  const blue = (value >>> 16) & 0xff;
  if (flags === 0xff) return null;
  if (flags & 0x08) return rgbOf(ctx.scheme[red] ?? "#000000");
  if (!(flags & 0x10)) return [red, green, blue];
  // A system colour index: the shape's own colours, Windows colours, and a change to apply.
  const index = value & 0xff;
  const change = value & 0xff00;
  /** @type {number[]} */
  let rgb = (index === 0xf0 || index === 0xf7
    ? (ctx.fill ?? ctx.line)
    : index === 0xf1 || index === 0xf2
      ? (ctx.line ?? ctx.fill)
      : index === 0xf5
        ? ctx.back
        : index < 0xf0
          ? SYSTEM[index]
          : null) ?? [0, 0, 0];
  if (change & 0x8000) {
    const gray = (rgb[0] ?? 0) * 0.299 + (rgb[1] ?? 0) * 0.587 + (rgb[2] ?? 0) * 0.114;
    rgb = [gray, gray, gray];
  }
  const kind = change & 0x0f00;
  rgb = rgb.map((c) => {
    if (kind === 0x0100) return (c * blue) / 255;
    if (kind === 0x0200) return 255 - ((255 - c) * blue) / 255;
    if (kind === 0x0300) return c + blue;
    if (kind === 0x0400) return c - blue;
    if (kind === 0x0500) return blue - c;
    if (kind === 0x0600) return c < blue ? 0 : 255;
    return c;
  });
  if (change & 0x2000) rgb = rgb.map((c) => 255 - c);
  if (change & 0x4000) rgb = rgb.map((c) => clamp(c) ^ 0x80);
  return rgb.map(clamp);
}
