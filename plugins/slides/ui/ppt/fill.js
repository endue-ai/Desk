// OfficeArt fills and lines ([MS-ODRAW] 2.3.7 Fill Style and 2.3.8 Line Style): solid, gradient
// (linear and radial, with the focus and the shade colours), picture, texture and pattern fills;
// line colour, width, dash and arrow heads. No DOM.
import { NO_FILL } from "../deck.js";
import { colorRef, css } from "./color.js";
import { arrayOf, fixed, flag, signed, value } from "./options.js";

/**
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Line} Line
 * @typedef {import("../deck.js").Stop} Stop
 * @typedef {import("./options.js").Options} Options
 * @typedef {import("./color.js").ColorContext} ColorContext
 */

const WHITE = [255, 255, 255];

/** The shape's colour context: its scheme and its own fill, line and fill background colours. */
export function shapeColors(/** @type {Options} */ opts, /** @type {string[]} */ scheme) {
  /** @param {number} pid @param {number} fallback @param {ColorContext} ctx */
  const rgb = (pid, fallback, ctx) => colorRef(value(opts, pid, fallback), ctx) ?? undefined;
  const line0 = rgb(0x1c0, 0, { scheme });
  const fill = rgb(0x181, 0xffffff, { scheme, line: line0 });
  const line = rgb(0x1c0, 0, { scheme, fill });
  return { scheme, fill, line, back: rgb(0x183, 0xffffff, { scheme, fill, line }) };
}

/** Stops run the other way: from the end colour to the start colour. @param {Stop[]} stops */
const reverse = (stops) => stops.map((s) => ({ pos: 1 - s.pos, color: s.color })).reverse();

/** fillShadeColors: colours at positions, or null. @param {Options} opts @param {ColorContext} ctx */
function shadeColors(opts, ctx) {
  const array = arrayOf(opts, 0x197);
  if (!array || array.size < 8 || array.offsets.length < 2) return null;
  const view = new DataView(array.data.buffer, array.data.byteOffset, array.data.byteLength);
  return array.offsets
    .map((at) => ({
      pos: Math.min(1, Math.max(0, view.getInt32(at + 4, true) / 65536)),
      color: css(colorRef(view.getUint32(at, true), ctx) ?? WHITE),
    }))
    .sort((a, b) => a.pos - b.pos);
}

/**
 * A shaded fill. The ramp runs from the fill colour to the fill background colour; the focus puts
 * the background colour at 100 - focus percent of the way, the ramp mirrored past it; a negative
 * focus or a negative angle swaps the colours. Angle 0 runs from the bottom up and turns
 * anticlockwise (as PowerPoint writes DrawingML's angles, and as LibreOffice reads them). Linear
 * for shade, shadeScale and shadeTitle; radial, from the outside in, for shadeCenter and shadeShape.
 */
function gradientOf(/** @type {Options} */ opts, /** @type {ColorContext} */ ctx, type = 4) {
  let ramp = shadeColors(opts, ctx) ?? [
    { pos: 0, color: css(ctx.fill ?? WHITE, fixed(opts, 0x182, 1)) },
    { pos: 1, color: css(ctx.back ?? WHITE, fixed(opts, 0x184, 1)) },
  ];
  const angle = fixed(opts, 0x18b);
  const focus = Math.max(-100, Math.min(100, signed(opts, 0x18c)));
  const swap = angle < 0 !== focus < 0;
  if (swap)
    ramp = ramp.map((s, i) => ({ pos: s.pos, color: ramp[ramp.length - 1 - i]?.color ?? s.color }));
  const p = 1 - Math.abs(focus) / 100;
  let stops =
    p >= 1
      ? ramp
      : p <= 0
        ? reverse(ramp)
        : [
            ...ramp.map((s) => ({ pos: s.pos * p, color: s.color })),
            ...reverse(ramp)
              .map((s) => ({ pos: p + s.pos * (1 - p), color: s.color }))
              .slice(1),
          ];
  if (type === 5 || type === 6)
    return /** @type {Fill} */ ({
      type: "gradient",
      shape: "radial",
      angle: 0,
      stops: reverse(stops),
    });
  let deg = ((-angle % 360) + 360) % 360;
  // With swapped colours the same drawing reads the other way round: the fill colour first.
  if (swap) {
    deg = (deg + 180) % 360;
    stops = reverse(stops);
  }
  return /** @type {Fill} */ ({ type: "gradient", shape: "linear", angle: deg, stops });
}

/**
 * A shape's fill. `background` is the slide's, for shapes filled with it.
 * @param {Options} opts @param {ColorContext} ctx @param {Fill} [background] @returns {Fill}
 */
export function fillOf(opts, ctx, background = NO_FILL) {
  if (flag(opts, 0x1bf, 4) === false) return NO_FILL;
  const type = value(opts, 0x180, 0);
  if (type === 2 || type === 3) {
    const blip = value(opts, 0x186);
    return blip ? { type: "image", image: `pib:${blip}`, tile: type === 2 } : NO_FILL;
  }
  if (type >= 4 && type <= 8) return gradientOf(opts, ctx, type);
  if (type === 9) return background;
  // Solid, and a pattern as its foreground colour.
  return { type: "solid", color: css(ctx.fill ?? WHITE, fixed(opts, 0x182, 1)) };
}

/** lineDashing values as the model's dashes. */
const DASHES = /** @type {import("../deck.js").Dash[]} */ ([
  "solid",
  "dash",
  "dot",
  "dashDot",
  "dashDot",
  "dot",
  "dash",
  "longDash",
  "dashDot",
  "longDashDot",
  "longDashDot",
]);
/** lineStartArrowhead and lineEndArrowhead values as the model's heads. */
const HEADS = /** @type {import("../deck.js").ArrowHead[]} */ ([
  "none",
  "triangle",
  "stealth",
  "diamond",
  "oval",
  "arrow",
]);

/** A shape's line, or null when it has none. @param {Options} opts @param {ColorContext} ctx @returns {Line | null} */
export function lineOf(opts, ctx) {
  if (flag(opts, 0x1ff, 3) === false) return null;
  return {
    color: css(ctx.line ?? [0, 0, 0], fixed(opts, 0x1c1, 1)),
    width: Math.max(value(opts, 0x1cb, 9525) / 12700, 0.25),
    dash: DASHES[value(opts, 0x1ce)] ?? "dash",
    head: HEADS[value(opts, 0x1d0)] ?? "arrow",
    tail: HEADS[value(opts, 0x1d1)] ?? "arrow",
  };
}
