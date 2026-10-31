// DrawingML fills and lines: solid, gradient (as CSS gradient stops and angle), picture and pattern
// fills; line colour, width, dash and arrow heads; and the theme styles p:style refers to.
import { NO_FILL } from "../deck.js";
import { attr, kid, kids, num, relAttr } from "../xml.js";
import { childColor, childHex } from "./color.js";

/**
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Line} Line
 * @typedef {import("../deck.js").ArrowHead} ArrowHead
 * @typedef {import("../deck.js").Dash} Dash
 * @typedef {import("./color.js").ColorContext & {
 *   theme: import("./theme.js").Theme,
 *   image(rId: string | null): string | null,
 * }} PartContext  A part's colours and theme, and its images by relationship id.
 */

const FILL_NAMES = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];
const EMU = 12700;

/** The fill element among `el`'s children, or null. @param {Element | null | undefined} el */
export const fillElement = (el) => kid(el, ...FILL_NAMES);

/**
 * A fill element as a Fill; grpFill is the group's, passed in.
 * @param {Element | null} el
 * @param {PartContext} ctx
 * @param {Fill} [group]
 * @returns {Fill | undefined}
 */
export function fillOf(el, ctx, group = NO_FILL) {
  if (!el) return undefined;
  switch (el.localName) {
    case "noFill":
      return NO_FILL;
    case "solidFill": {
      const color = childColor(el, ctx);
      return color ? { type: "solid", color } : NO_FILL;
    }
    case "gradFill": {
      const stops = kids(kid(el, "gsLst"), "gs")
        .map((gs) => ({ pos: num(gs, "pos") / 100000, color: childColor(gs, ctx) ?? "#000000" }))
        .sort((a, b) => a.pos - b.pos);
      if (stops.length === 0) return NO_FILL;
      const path = kid(el, "path");
      if (path && attr(path, "path") !== null)
        return { type: "gradient", shape: "radial", angle: 0, stops };
      const lin = kid(el, "lin");
      // DrawingML measures clockwise from the x axis; CSS measures clockwise from the top.
      const angle = ((lin ? num(lin, "ang") / 60000 : 0) + 90) % 360;
      return { type: "gradient", shape: "linear", angle, stops };
    }
    case "blipFill": {
      const image = ctx.image(relAttr(kid(el, "blip"), "embed"));
      return image ? { type: "image", image, tile: Boolean(kid(el, "tile")) } : NO_FILL;
    }
    case "pattFill": {
      const color = childColor(kid(el, "fgClr"), ctx);
      return color ? { type: "solid", color } : NO_FILL;
    }
    case "grpFill":
      return group;
    default:
      return undefined;
  }
}

/**
 * A theme style picked by a p:style reference (fillRef, lnRef, bgRef), with phClr set to the
 * reference's own colour.
 * @param {Element | null} ref
 * @param {Element[]} list
 * @param {PartContext} ctx
 * @returns {{ el: Element, ctx: PartContext } | null}
 */
export function styleRef(ref, list, ctx) {
  if (!ref) return null;
  const idx = num(ref, "idx");
  const el = list[idx >= 1000 ? idx - 1001 : idx - 1];
  if (!el || idx === 0) return null;
  return { el, ctx: { ...ctx, phClr: childHex(ref, ctx) ?? ctx.phClr } };
}

/** The fill a p:style's fillRef names, or undefined. @param {Element | null} style @param {PartContext} ctx */
export function styleFill(style, ctx) {
  const ref = kid(style, "fillRef");
  if (ref && num(ref, "idx") === 0) return NO_FILL;
  const found = styleRef(ref, ctx.theme.fills, ctx);
  return found ? fillOf(found.el, found.ctx) : undefined;
}

const HEADS = ["triangle", "stealth", "arrow", "diamond", "oval"];
const DASHES = /** @type {Record<string, Dash>} */ ({
  solid: "solid",
  dot: "dot",
  sysDot: "dot",
  dash: "dash",
  sysDash: "dash",
  lgDash: "longDash",
  dashDot: "dashDot",
  sysDashDot: "dashDot",
  lgDashDot: "longDashDot",
  lgDashDotDot: "longDashDot",
  sysDashDotDot: "dashDot",
});

/**
 * A line from a chain of a:ln elements, lowest priority first, each with its own context: a theme
 * line (lnRef), then the master's, the layout's and the shape's own. No colour means no line.
 * @param {Array<{ el: Element | null, ctx: PartContext }>} chain
 * @returns {Line | null}
 */
export function lineOf(chain) {
  /** @type {string | null} */
  let color = null;
  let width = 0.75;
  /** @type {Dash} */
  let dash = "solid";
  /** @type {ArrowHead} */
  let head = "none";
  /** @type {ArrowHead} */
  let tail = "none";
  for (const { el, ctx } of chain) {
    if (!el) continue;
    if (attr(el, "w") !== null) width = num(el, "w") / EMU;
    const fill = fillElement(el);
    if (fill?.localName === "noFill") color = null;
    else if (fill?.localName === "solidFill") color = childColor(fill, ctx);
    else if (fill?.localName === "gradFill") color = childColor(kid(kid(fill, "gsLst"), "gs"), ctx);
    const prst = attr(kid(el, "prstDash"), "val");
    if (prst) dash = DASHES[prst] ?? "dash";
    const headType = attr(kid(el, "headEnd"), "type");
    if (headType) head = /** @type {ArrowHead} */ (HEADS.includes(headType) ? headType : "none");
    const tailType = attr(kid(el, "tailEnd"), "type");
    if (tailType) tail = /** @type {ArrowHead} */ (HEADS.includes(tailType) ? tailType : "none");
  }
  if (!color) return null;
  return { color, width: Math.max(width, 0.25), dash, head, tail };
}

/** The a:ln a p:style's lnRef names, with its context, or null. */
export function styleLine(/** @type {Element | null} */ style, /** @type {PartContext} */ ctx) {
  const found = styleRef(kid(style, "lnRef"), ctx.theme.lines, ctx);
  return found ? { el: found.el, ctx: found.ctx } : null;
}

/** A background (p:bg) as a Fill, or undefined when the part has none. */
export function backgroundOf(/** @type {Element | null} */ bg, /** @type {PartContext} */ ctx) {
  if (!bg) return undefined;
  const pr = kid(bg, "bgPr");
  if (pr) return fillOf(fillElement(pr), ctx);
  const ref = kid(bg, "bgRef");
  if (!ref) return undefined;
  const found = styleRef(ref, ctx.theme.backgrounds, ctx);
  if (found) return fillOf(found.el, found.ctx);
  const color = childColor(ref, ctx);
  return color ? { type: "solid", color } : undefined;
}
