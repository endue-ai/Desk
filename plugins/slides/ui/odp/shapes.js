// ODF drawing shapes as elements: frames (text boxes, images, tables, objects with their replacement
// images), custom shapes (known types by name, others as their bounding rectangle), rectangles,
// ellipses, lines, connectors, polygons, paths and groups.
import { boxOf, NO_FILL, rect, textOf } from "../deck.js";
import { presetName } from "../geometry.js";
import { attr, kid, kids } from "../xml.js";
import { chainOf, fillFrom, length, lineFrom, propsOf } from "./style.js";
import { readOdpTable } from "./table.js";
import { readParagraphs } from "./text.js";

/**
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Geometry} Geometry
 * @typedef {import("../deck.js").PathCommand} PathCommand
 * @typedef {import("./style.js").Styles} Styles
 */

const TYPES = /** @type {Record<string, string>} */ ({
  rectangle: "rect",
  "round-rectangle": "roundRect",
  "round-quadrat": "roundRect",
  ellipse: "ellipse",
  circle: "ellipse",
  "isosceles-triangle": "triangle",
  "right-triangle": "rtTriangle",
  diamond: "diamond",
  parallelogram: "parallelogram",
  trapezoid: "trapezoid",
  pentagon: "pentagon",
  "pentagon-right": "homePlate",
  hexagon: "hexagon",
  octagon: "octagon",
  chevron: "chevron",
  "right-arrow": "rightArrow",
  "left-arrow": "leftArrow",
  "up-arrow": "upArrow",
  "down-arrow": "downArrow",
});

/** A box from svg:x/y/width/height, or from draw:transform's rotate and translate. @param {Element} el */
function boxOfShape(el) {
  const w = length(attr(el, "width"));
  const h = length(attr(el, "height"));
  const transform = attr(el, "transform");
  if (transform) {
    const rotate = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/.exec(transform);
    const translate = /translate\s*\(\s*(\S+)\s+(\S+?)\s*\)/.exec(transform);
    const theta = -(Number.parseFloat(rotate?.[1] ?? "0") || 0);
    const tx = length(translate?.[1]);
    const ty = length(translate?.[2]);
    // The shape turns about its top left, then moves; the model turns about the centre.
    const cx = tx + (w / 2) * Math.cos(theta) - (h / 2) * Math.sin(theta);
    const cy = ty + (w / 2) * Math.sin(theta) + (h / 2) * Math.cos(theta);
    return boxOf({ x: cx - w / 2, y: cy - h / 2, w, h, rot: (theta * 180) / Math.PI });
  }
  return boxOf({ x: length(attr(el, "x")), y: length(attr(el, "y")), w, h });
}

/** svg:points in a viewBox, as a path. @param {Element} el @param {boolean} closed @returns {Geometry} */
function polygon(el, closed) {
  const [, , vw = 0, vh = 0] = (attr(el, "viewBox") ?? "").split(/[\s,]+/).map(Number);
  const nums = (attr(el, "points") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  /** @type {PathCommand[]} */
  const commands = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    commands.push({ cmd: i === 0 ? "M" : "L", x: nums[i] ?? 0, y: nums[i + 1] ?? 0 });
  if (closed) commands.push({ cmd: "Z" });
  return {
    name: "custom",
    adjust: {},
    paths: [{ w: vw, h: vh, fill: closed, stroke: true, commands }],
  };
}

/** svg:d (M, L, H, V, C, Q, Z, absolute or relative) in a viewBox, as a path. @param {Element} el @returns {Geometry} */
function svgPath(el) {
  const [, , vw = 0, vh = 0] = (attr(el, "viewBox") ?? "").split(/[\s,]+/).map(Number);
  const tokens = (attr(el, "d") ?? "").match(/[a-zA-Z]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  /** @type {PathCommand[]} */
  const commands = [];
  let x = 0;
  let y = 0;
  let cmd = "";
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i] ?? "")) cmd = tokens[i++] ?? "";
    const rel = cmd === cmd.toLowerCase();
    const next = () => Number(tokens[i++] ?? 0);
    const up = cmd.toUpperCase();
    if (up === "Z") {
      commands.push({ cmd: "Z" });
      continue;
    }
    if (up === "M" || up === "L" || up === "T") {
      const [nx, ny] = [next() + (rel ? x : 0), next() + (rel ? y : 0)];
      commands.push({ cmd: up === "M" ? "M" : "L", x: nx, y: ny });
      [x, y] = [nx, ny];
      if (up === "M") cmd = rel ? "l" : "L";
    } else if (up === "H" || up === "V") {
      const v = next();
      if (up === "H") x = v + (rel ? x : 0);
      else y = v + (rel ? y : 0);
      commands.push({ cmd: "L", x, y });
    } else if (up === "C" || up === "S" || up === "Q") {
      const count = up === "C" ? 3 : 2;
      const pts = Array.from({ length: count }, () => [
        next() + (rel ? x : 0),
        next() + (rel ? y : 0),
      ]);
      const [p1 = [x, y], p2 = [x, y], p3] = pts;
      const [ex = 0, ey = 0] = p3 ?? p2;
      const [c2x = 0, c2y = 0] = p3 ? p2 : p1;
      commands.push({ cmd: "C", x1: p1[0] ?? x, y1: p1[1] ?? y, x2: c2x, y2: c2y, x: ex, y: ey });
      [x, y] = [ex, ey];
    } else if (up === "A") {
      i += 5;
      const [nx, ny] = [next() + (rel ? x : 0), next() + (rel ? y : 0)];
      commands.push({ cmd: "L", x: nx, y: ny });
      [x, y] = [nx, ny];
    } else i++;
  }
  return {
    name: "custom",
    adjust: {},
    paths: [{ w: vw, h: vh, fill: commands.some((c) => c.cmd === "Z"), stroke: true, commands }],
  };
}

/**
 * @typedef {{ index: Styles, master?: boolean }} ShapeContext  master: a master page, whose
 *   presentation objects (title, outline, date, footer, page number) are placeholders, not drawn.
 */

/** A style-name attribute in the namespace whose URI contains `ns`. */
const styleName = (/** @type {Element} */ el, /** @type {string} */ ns) => {
  for (const a of el.attributes)
    if (a.localName === "style-name" && (a.namespaceURI ?? "").includes(ns)) return a.value;
  return null;
};

/** The style chain of a shape: its presentation style, then its graphic style. */
const chainFor = (/** @type {Element} */ el, /** @type {Styles} */ index) => [
  ...chainOf(index, "presentation", styleName(el, ":presentation:")),
  ...chainOf(index, "graphic", styleName(el, ":drawing:")),
];

/** The text body of a holder, with the frame's anchor and padding. */
function textBody(
  /** @type {Element | null} */ holder,
  /** @type {Element[]} */ chain,
  /** @type {Styles} */ index,
) {
  if (!holder || !kids(holder, "p", "h", "list").length) return null;
  const props = propsOf(chain, "graphic-properties");
  const listStyle =
    [...chain]
      .reverse()
      .map((s) => kid(kid(s, "graphic-properties"), "list-style"))
      .find(Boolean) ?? null;
  const align = props["textarea-vertical-align"];
  return textOf(readParagraphs(holder, { index, frame: chain, listStyle }), {
    anchor: align === "middle" ? "middle" : align === "bottom" ? "bottom" : "top",
    inset: {
      left: length(props["padding-left"], 7.09),
      right: length(props["padding-right"], 7.09),
      top: length(props["padding-top"], 3.54),
      bottom: length(props["padding-bottom"], 3.54),
    },
    wrap: props["wrap-option"] !== "no-wrap",
  });
}

/** One shape, or several for a group. @param {Element} el @param {ShapeContext} ctx @returns {SlideElement[]} */
function readShape(el, ctx) {
  const { index } = ctx;
  if (attr(el, "placeholder") === "true" || (ctx.master && attr(el, "class"))) return [];
  const name = el.localName;
  if (name === "g") return kids(el).flatMap((c) => readShape(c, ctx));
  const chain = chainFor(el, index);
  const props = propsOf(chain, "graphic-properties");
  const placeholder = attr(el, "class") ?? "";
  const label =
    kid(el, "title")?.textContent || kid(el, "desc")?.textContent || attr(el, "name") || "";
  let box = boxOfShape(el);
  const shape = (/** @type {Geometry} */ geometry, /** @type {Element | null} */ holder) =>
    /** @type {SlideElement} */ ({
      type: "shape",
      name: attr(el, "name") ?? name,
      box,
      geometry,
      fill: fillFrom(props, index) ?? NO_FILL,
      line: lineFrom(props),
      text: textBody(holder, chain, index),
      placeholder,
    });
  if (name === "frame") {
    const box0 = box;
    const textBox = kid(el, "text-box");
    if (textBox) return [shape(rect(), textBox)];
    const table = kid(el, "table");
    if (table) return [readOdpTable(table, box0, attr(el, "name") ?? "Table", index)];
    const images = kids(el, "image");
    const usable =
      images.find(
        (i) =>
          /\.(png|jpe?g|gif|svg|bmp|webp)$/i.test(attr(i, "href") ?? "") || kid(i, "binary-data"),
      ) ?? null;
    const object = kid(el, "object", "object-ole", "plugin");
    if (usable || (images.length && !object))
      return [
        {
          type: "picture",
          name: attr(el, "name") ?? "Picture",
          box: box0,
          image: index.image(usable),
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
          line: lineFrom(props),
          geometry: rect(),
          label: label || "Picture",
        },
      ];
    const what =
      placeholder === "chart" ? "Chart" : kid(el, "plugin") ? "Media" : "Embedded object";
    return [{ type: "placeholder", name: attr(el, "name") ?? what, box: box0, label: what }];
  }
  if (name === "custom-shape") {
    const geo = kid(el, "enhanced-geometry");
    const type = attr(geo, "type") ?? "rectangle";
    const preset = type.startsWith("ooxml-") ? presetName(type.slice(6)) : (TYPES[type] ?? "rect");
    box = {
      ...box,
      flipH: attr(geo, "mirror-horizontal") === "true",
      flipV: attr(geo, "mirror-vertical") === "true",
    };
    return [shape({ name: preset, adjust: {} }, el)];
  }
  if (name === "rect") {
    const radius = length(attr(el, "corner-radius"));
    const ss = Math.min(box.w, box.h) || 1;
    return [
      shape(radius ? { name: "roundRect", adjust: { adj: (radius / ss) * 100000 } } : rect(), el),
    ];
  }
  if (name === "ellipse" || name === "circle") return [shape({ name: "ellipse", adjust: {} }, el)];
  if (name === "line" || name === "connector") {
    const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => length(attr(el, k)));
    box = boxOf({
      x: Math.min(x1 ?? 0, x2 ?? 0),
      y: Math.min(y1 ?? 0, y2 ?? 0),
      w: Math.abs((x2 ?? 0) - (x1 ?? 0)),
      h: Math.abs((y2 ?? 0) - (y1 ?? 0)),
      flipH: (x2 ?? 0) < (x1 ?? 0),
      flipV: (y2 ?? 0) < (y1 ?? 0),
    });
    const line = shape({ name: "line", adjust: {} }, el);
    return [line.type === "shape" ? { ...line, fill: NO_FILL } : line];
  }
  if (name === "polygon" || name === "polyline")
    return [shape(polygon(el, name === "polygon"), el)];
  if (name === "path") return [shape(svgPath(el), el)];
  return [];
}

/** The shapes of a page or master page, in drawing order. @param {Element} container @param {ShapeContext} ctx */
export function readOdpShapes(container, ctx) {
  /** @type {SlideElement[]} */
  const out = [];
  for (const el of kids(container)) {
    if (["notes", "forms", "animations", "page-thumbnail"].includes(el.localName)) continue;
    try {
      out.push(...readShape(el, ctx));
    } catch {
      // A shape it cannot read is left out; the rest of the slide still shows.
    }
  }
  return out;
}
