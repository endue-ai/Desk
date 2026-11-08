// A PresentationML shape tree as elements: shapes (with placeholder inheritance from the layout and
// master), connectors, pictures with crop, groups with their child frame, graphic frames (tables,
// SmartArt drawings, OLE fallback pictures, charts as labelled boxes) and alternate content.
import { boxOf, NO_FILL, rect } from "../deck.js";
import { presetName } from "../geometry.js";
import { attr, bool, kid, kids, num, path, relAttr } from "../xml.js";
import { childColor } from "./color.js";
import { fillElement, fillOf, lineOf, styleFill, styleLine } from "./fill.js";
import { readTable } from "./table.js";
import { readText } from "./text.js";
import { fontOf } from "./theme.js";

/**
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Geometry} Geometry
 * @typedef {import("./fill.js").PartContext} PartContext
 * @typedef {{ el: Element, ctx: PartContext }} Inherited
 * @typedef {{
 *   ctx: PartContext,
 *   inherit(type: string, idx: string | null): Inherited[],
 *   lists(type: string): Element[],
 *   table(id: string | null): Element | null,
 *   drawing(frame: Element): Promise<Element | null>,
 *   slideNumber: number,
 *   place?: (box: Box) => Box,
 *   groupFill?: Fill,
 * }} Scope
 *   inherit: the layout's and master's placeholder shapes a placeholder takes from, lowest first.
 *   lists: the text styles under a shape's own (by placeholder type, "" for other shapes).
 *   drawing: a SmartArt frame's cached drawing (its spTree), or null.
 */

const EMU = 12700;

/** The box of an a:xfrm or p:xfrm, in points. @param {Element | null} xfrm @returns {Box | null} */
export function boxOfXfrm(xfrm) {
  if (!xfrm) return null;
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off && !ext) return null;
  return boxOf({
    x: num(off, "x") / EMU,
    y: num(off, "y") / EMU,
    w: num(ext, "cx") / EMU,
    h: num(ext, "cy") / EMU,
    rot: num(xfrm, "rot") / 60000,
    flipH: bool(xfrm, "flipH"),
    flipV: bool(xfrm, "flipV"),
  });
}

/** The geometry in an spPr, or null. @param {Element | null} spPr @returns {Geometry | null} */
function geometryOf(spPr) {
  const prst = kid(spPr, "prstGeom");
  if (prst) {
    /** @type {Record<string, number>} */
    const adjust = {};
    for (const gd of kids(kid(prst, "avLst"), "gd")) {
      const m = /^val\s+(-?\d+)/.exec(attr(gd, "fmla") ?? "");
      if (m) adjust[attr(gd, "name") ?? ""] = Number(m[1]);
    }
    return { name: presetName(attr(prst, "prst") ?? "rect"), adjust };
  }
  const cust = kid(spPr, "custGeom");
  return cust ? customGeometry(cust) : null;
}

/** custGeom's paths as M, L, C and Z commands; arcs become cubic curves. @param {Element} cust */
function customGeometry(cust) {
  const paths = kids(kid(cust, "pathLst"), "path").map((p) => {
    /** @type {import("../deck.js").PathCommand[]} */
    const commands = [];
    let x = 0;
    let y = 0;
    const pt = (/** @type {Element | null} */ el) => [num(el, "x"), num(el, "y")];
    for (const c of kids(p)) {
      const pts = kids(c, "pt").map(pt);
      if (c.localName === "moveTo" || c.localName === "lnTo") {
        [x = 0, y = 0] = pts[0] ?? [];
        commands.push({ cmd: c.localName === "moveTo" ? "M" : "L", x, y });
      } else if (c.localName === "cubicBezTo" && pts.length === 3) {
        const [[x1 = 0, y1 = 0] = [], [x2 = 0, y2 = 0] = [], [ex = 0, ey = 0] = []] = pts;
        commands.push({ cmd: "C", x1, y1, x2, y2, x: ex, y: ey });
        [x, y] = [ex, ey];
      } else if (c.localName === "quadBezTo" && pts.length === 2) {
        const [[qx = 0, qy = 0] = [], [ex = 0, ey = 0] = []] = pts;
        const k = 2 / 3;
        commands.push({
          cmd: "C",
          x1: x + k * (qx - x),
          y1: y + k * (qy - y),
          x2: ex + k * (qx - ex),
          y2: ey + k * (qy - ey),
          x: ex,
          y: ey,
        });
        [x, y] = [ex, ey];
      } else if (c.localName === "arcTo") {
        [x, y] = arcTo(
          commands,
          x,
          y,
          num(c, "wR"),
          num(c, "hR"),
          num(c, "stAng") / 60000,
          num(c, "swAng") / 60000,
        );
      } else if (c.localName === "close") commands.push({ cmd: "Z" });
    }
    return {
      w: num(p, "w"),
      h: num(p, "h"),
      fill: attr(p, "fill") !== "none",
      stroke: attr(p, "stroke") !== "0",
      commands,
    };
  });
  return { name: "custom", adjust: {}, paths };
}

/** An arcTo from the current point, as cubic curves of at most 90 degrees each. */
function arcTo(
  /** @type {import("../deck.js").PathCommand[]} */ out,
  /** @type {number} */ x,
  /** @type {number} */ y,
  /** @type {number} */ rx,
  /** @type {number} */ ry,
  /** @type {number} */ start,
  /** @type {number} */ sweep,
) {
  const rad = Math.PI / 180;
  const cx = x - rx * Math.cos(start * rad);
  const cy = y - ry * Math.sin(start * rad);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const step = (sweep / steps) * rad;
  const k = (4 / 3) * Math.tan(step / 4);
  let a = start * rad;
  let px = x;
  let py = y;
  for (let i = 0; i < steps; i++) {
    const b = a + step;
    const ex = cx + rx * Math.cos(b);
    const ey = cy + ry * Math.sin(b);
    out.push({
      cmd: "C",
      x1: px - k * rx * Math.sin(a),
      y1: py + k * ry * Math.cos(a),
      x2: ex + k * rx * Math.sin(b),
      y2: ey - k * ry * Math.cos(b),
      x: ex,
      y: ey,
    });
    [px, py, a] = [ex, ey, b];
  }
  return [px, py];
}

/** The fontRef of a p:style: the theme font and colour it names. */
function fontRefOf(/** @type {Element | null} */ style, /** @type {PartContext} */ ctx) {
  const ref = kid(style, "fontRef");
  if (!ref) return null;
  const idx = attr(ref, "idx");
  const font =
    idx === "major"
      ? fontOf("+mj-lt", ctx.theme)
      : idx === "minor"
        ? fontOf("+mn-lt", ctx.theme)
        : "";
  return { font, color: childColor(ref, ctx) };
}

/** A shape or connector, with what its placeholder inherits. @param {Element} sp @param {Scope} scope */
function readShape(sp, scope) {
  const nv = kid(sp, "nvSpPr", "nvCxnSpPr");
  const cNvPr = kid(nv, "cNvPr");
  const ph = path(nv, "nvPr", "ph");
  const type = ph ? (attr(ph, "type") ?? "body") : "";
  const chain = [...(ph ? scope.inherit(type, attr(ph, "idx")) : []), { el: sp, ctx: scope.ctx }];
  const top = [...chain].reverse();
  const spPrs = top.map((c) => ({ spPr: kid(c.el, "spPr"), ctx: c.ctx }));
  const box = top.map((c) => boxOfXfrm(path(c.el, "spPr", "xfrm"))).find(Boolean) ?? boxOf();
  const geometry = spPrs.map((s) => geometryOf(s.spPr)).find(Boolean) ?? rect();
  const style = top.map((c) => kid(c.el, "style")).find(Boolean) ?? null;
  const own = spPrs.find((s) => fillElement(s.spPr));
  const fill =
    (own ? fillOf(fillElement(own.spPr), own.ctx, scope.groupFill) : undefined) ??
    styleFill(style, scope.ctx) ??
    NO_FILL;
  const lines = [
    styleLine(style, scope.ctx) ?? { el: null, ctx: scope.ctx },
    ...chain.map((c) => ({ el: path(c.el, "spPr", "ln"), ctx: c.ctx })),
  ];
  const txBody = kid(sp, "txBody");
  const text = readText(txBody, {
    ctx: scope.ctx,
    bodies: chain
      .slice(0, -1)
      .map((c) => path(c.el, "txBody", "bodyPr"))
      .filter((e) => e !== null),
    lists: scope.lists(type),
    upper: chain
      .slice(0, -1)
      .map((c) => path(c.el, "txBody", "lstStyle"))
      .filter((e) => e !== null),
    fontRef: fontRefOf(style, scope.ctx),
    slideNumber: scope.slideNumber,
  });
  return /** @type {SlideElement} */ ({
    type: "shape",
    name: attr(cNvPr, "name") ?? "",
    box: place(box, scope),
    geometry,
    fill,
    line: lineOf(lines),
    text,
    placeholder: type,
  });
}

const UNDRAWABLE = /\.(emf|wmf|emz|wmz|wdp|jxr|pict?)$/i;

/** @param {Element} pic @param {Scope} scope */
function readPicture(pic, scope, /** @type {Box | null} */ frame = null) {
  const nv = kid(pic, "nvPicPr");
  const cNvPr = kid(nv, "cNvPr");
  const ph = path(nv, "nvPr", "ph");
  const chain = ph ? scope.inherit(attr(ph, "type") ?? "pic", attr(ph, "idx")) : [];
  const box =
    frame ??
    [
      boxOfXfrm(path(pic, "spPr", "xfrm")),
      ...chain.reverse().map((c) => boxOfXfrm(path(c.el, "spPr", "xfrm"))),
    ].find(Boolean) ??
    boxOf();
  const blipFill = kid(pic, "blipFill");
  const blip = kid(blipFill, "blip");
  const svg = [...(blip?.getElementsByTagNameNS("*", "svgBlip") ?? [])][0];
  let image = scope.ctx.image(relAttr(svg, "embed")) ?? scope.ctx.image(relAttr(blip, "embed"));
  if (image && UNDRAWABLE.test(image)) image = null;
  const src = kid(blipFill, "srcRect");
  const name = attr(cNvPr, "name") ?? "Picture";
  return /** @type {SlideElement} */ ({
    type: "picture",
    name,
    box: place(box, scope),
    image,
    crop: {
      left: num(src, "l") / 100000,
      top: num(src, "t") / 100000,
      right: num(src, "r") / 100000,
      bottom: num(src, "b") / 100000,
    },
    line: lineOf([{ el: path(pic, "spPr", "ln"), ctx: scope.ctx }]),
    geometry: geometryOf(kid(pic, "spPr")) ?? rect(),
    label: attr(cNvPr, "descr") || name,
  });
}

/** @param {Box} box @param {Scope} scope */
const place = (box, scope) => (scope.place ? scope.place(box) : box);

/** A group: its box, and its children placed in its frame. @param {Element} grp @param {Scope} scope */
async function readGroup(grp, scope) {
  const xfrm = path(grp, "grpSpPr", "xfrm");
  const box = boxOfXfrm(xfrm) ?? boxOf();
  const chOff = kid(xfrm, "chOff");
  const chExt = kid(xfrm, "chExt");
  const cx = num(chOff, "x") / EMU;
  const cy = num(chOff, "y") / EMU;
  const sx = chExt && num(chExt, "cx") ? box.w / (num(chExt, "cx") / EMU) : 1;
  const sy = chExt && num(chExt, "cy") ? box.h / (num(chExt, "cy") / EMU) : 1;
  const own = fillOf(fillElement(kid(grp, "grpSpPr")), scope.ctx, scope.groupFill);
  const children = await readTree(grp, {
    ...scope,
    groupFill: own ?? scope.groupFill,
    place: (b) => ({ ...b, x: (b.x - cx) * sx, y: (b.y - cy) * sy, w: b.w * sx, h: b.h * sy }),
  });
  return /** @type {SlideElement} */ ({
    type: "group",
    name: attr(path(grp, "nvGrpSpPr", "cNvPr"), "name") ?? "Group",
    box: place(box, scope),
    children,
  });
}

/** A graphic frame: a table, a SmartArt drawing, an OLE picture, or a labelled box. */
async function readFrame(/** @type {Element} */ frame, /** @type {Scope} */ scope) {
  const box = boxOfXfrm(kid(frame, "xfrm")) ?? boxOf();
  const name = attr(path(frame, "nvGraphicFramePr", "cNvPr"), "name") ?? "";
  const data = path(frame, "graphic", "graphicData");
  const uri = attr(data, "uri") ?? "";
  const tbl = kid(data, "tbl");
  if (tbl) return readTable(tbl, place(box, scope), name, scope);
  if (uri.endsWith("/diagram")) {
    const tree = await scope.drawing(frame).catch(() => null);
    if (tree) {
      const children = await readTree(tree, { ...scope, place: undefined });
      return /** @type {SlideElement} */ ({
        type: "group",
        name,
        box: place(box, scope),
        children,
      });
    }
  }
  const pic = [...(data?.getElementsByTagNameNS("*", "pic") ?? [])][0];
  if (pic) return readPicture(pic, { ...scope, place: undefined }, place(box, scope));
  const label = uri.endsWith("/chart")
    ? "Chart"
    : uri.endsWith("/diagram")
      ? "SmartArt"
      : uri.includes("ole")
        ? "Embedded object"
        : name || "Object";
  return /** @type {SlideElement} */ ({ type: "placeholder", name, box: place(box, scope), label });
}

/**
 * The elements of an spTree (or a group, or a SmartArt drawing's tree), in drawing order.
 * @param {Element} tree
 * @param {Scope} scope
 * @param {(el: Element) => boolean} [keep]  which children to read (layouts and masters skip placeholders)
 * @returns {Promise<SlideElement[]>}
 */
export async function readTree(tree, scope, keep = () => true) {
  /** @type {SlideElement[]} */
  const out = [];
  for (const child of kids(tree)) {
    if (!keep(child)) continue;
    const hidden = bool(
      kid(kid(child, "nvSpPr", "nvPicPr", "nvGrpSpPr", "nvCxnSpPr", "nvGraphicFramePr"), "cNvPr"),
      "hidden",
    );
    if (hidden) continue;
    const name = child.localName;
    if (name === "sp" || name === "cxnSp") out.push(readShape(child, scope));
    else if (name === "pic") out.push(readPicture(child, scope));
    else if (name === "grpSp") out.push(await readGroup(child, scope));
    else if (name === "graphicFrame") out.push(await readFrame(child, scope));
    else if (name === "AlternateContent") {
      const pick = kid(child, "Fallback") ?? kid(child, "Choice");
      if (pick) out.push(...(await readTree(pick, scope, keep)));
    }
  }
  return out;
}
