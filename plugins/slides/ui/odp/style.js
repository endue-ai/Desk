// ODF styles: named and automatic styles by family with their parent chains, default styles, list
// styles, font faces, gradients and fill images; lengths in points; fills and lines as the model's.
import { NO_FILL } from "../deck.js";
import { attr, kids } from "../xml.js";

/**
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Line} Line
 * @typedef {Record<string, string>} Props  attributes by local name
 * @typedef {{
 *   style(family: string, name: string | null): Element | null,
 *   defaults(family: string): Element | null,
 *   list(name: string | null): Element | null,
 *   font(name: string | null): string,
 *   named(kind: string, name: string | null): Element | null,
 *   image(holder: Element | null): string | null,
 * }} Styles  image: the id of the picture an element (draw:image, draw:fill-image) holds, by its
 *   href or its office:binary-data.
 */

const UNITS = /** @type {Record<string, number>} */ ({
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  in: 72,
  pt: 1,
  pc: 12,
  px: 0.75,
});

/** A length in points: "2cm", "12pt", "0.5in". */
export function length(/** @type {string | null | undefined} */ value, fallback = 0) {
  const m = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/i.exec(value ?? "");
  if (!m) return fallback;
  return Number.parseFloat(m[1] ?? "0") * (UNITS[(m[2] ?? "pt").toLowerCase() || "pt"] ?? 1);
}

/**
 * The style index of a document: automatic styles first, then common ones, then the font faces.
 * @param {Array<Element | null>} roots  office:document-styles / -content, or one flat document
 * @param {(holder: Element) => string | null} imageOf  the image id of a draw:image or draw:fill-image
 * @returns {Styles}
 */
export function styleIndex(roots, imageOf) {
  /** @type {Map<string, Element>} */
  const styles = new Map();
  /** @type {Map<string, Element>} */
  const defaults = new Map();
  /** @type {Map<string, Element>} */
  const named = new Map();
  /** @type {Map<string, string>} */
  const fonts = new Map();
  const sections = ["automatic-styles", "styles"];
  for (const section of sections)
    for (const root of roots)
      for (const block of kids(root, section))
        for (const el of kids(block)) {
          const name = attr(el, "name");
          if (el.localName === "style" && name) {
            const key = `${attr(el, "family")}:${name}`;
            if (!styles.has(key)) styles.set(key, el);
          } else if (el.localName === "default-style") defaults.set(attr(el, "family") ?? "", el);
          else if (name && !named.has(`${el.localName}:${name}`))
            named.set(`${el.localName}:${name}`, el);
        }
  for (const root of roots)
    for (const face of kids(kids(root, "font-face-decls")[0], "font-face"))
      fonts.set(
        attr(face, "name") ?? "",
        (attr(face, "font-family") ?? "").replace(/^['"]|['"]$/g, ""),
      );
  return {
    style: (family, name) => (name ? (styles.get(`${family}:${name}`) ?? null) : null),
    defaults: (family) => defaults.get(family) ?? null,
    list: (name) => (name ? (named.get(`list-style:${name}`) ?? null) : null),
    font: (name) => (name ? (fonts.get(name) ?? name) : ""),
    named: (kind, name) => (name ? (named.get(`${kind}:${name}`) ?? null) : null),
    image: (holder) => (holder ? imageOf(holder) : null),
  };
}

/** A style's chain, the default style first and the style itself last. */
export function chainOf(
  /** @type {Styles} */ index,
  /** @type {string} */ family,
  /** @type {string | null} */ name,
) {
  /** @type {Element[]} */
  const chain = [];
  const seen = new Set();
  for (let style = index.style(family, name); style && !seen.has(style); ) {
    seen.add(style);
    chain.unshift(style);
    style = index.style(family, attr(style, "parent-style-name"));
  }
  const fallback = index.defaults(family);
  if (fallback) chain.unshift(fallback);
  return chain;
}

/**
 * The properties of one kind (graphic-properties, text-properties, ...) along chains of styles,
 * later ones winning.
 * @param {Element[]} chain
 * @param {string} kind
 * @param {Props} [into]
 * @returns {Props}
 */
export function propsOf(chain, kind, into = {}) {
  for (const style of chain)
    for (const el of kids(style, kind)) for (const a of el.attributes) into[a.localName] = a.value;
  return into;
}

const opacity = (/** @type {Props} */ p) => (p.opacity ? Number.parseFloat(p.opacity) / 100 : 1);

/** A colour with an opacity, as CSS. */
function withAlpha(/** @type {string} */ hex, /** @type {number} */ alpha) {
  if (alpha >= 1 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A fill from graphic or drawing-page properties. @param {Props} p @param {Styles} index @returns {Fill | undefined} */
export function fillFrom(p, index) {
  const kind = p.fill;
  if (kind === undefined) return undefined;
  if (kind === "none") return NO_FILL;
  if (kind === "solid")
    return { type: "solid", color: withAlpha(p["fill-color"] ?? "#729fcf", opacity(p)) };
  if (kind === "gradient") {
    const g = index.named("gradient", p["fill-gradient-name"] ?? null);
    if (!g) return { type: "solid", color: p["fill-color"] ?? "#729fcf" };
    const start = attr(g, "start-color") ?? "#000000";
    const end = attr(g, "end-color") ?? "#ffffff";
    const border = Number.parseFloat(attr(g, "border") ?? "0") / 100 || 0;
    const raw = attr(g, "angle") ?? "0";
    const angle = raw.endsWith("deg")
      ? Number.parseFloat(raw)
      : raw.endsWith("rad")
        ? (Number.parseFloat(raw) * 180) / Math.PI
        : Number.parseFloat(raw) / 10;
    const style = attr(g, "style") ?? "linear";
    const stops = kids(g, "color-stop").map((s) => ({
      pos: Number.parseFloat(attr(s, "offset") ?? "0"),
      color: attr(s, "color-value") ?? start,
    }));
    if (style === "linear" || style === "axial") {
      const css = (((180 - (angle || 0)) % 360) + 360) % 360;
      const list = stops.length
        ? stops
        : style === "axial"
          ? [
              { pos: 0, color: start },
              { pos: 0.5, color: end },
              { pos: 1, color: start },
            ]
          : [
              { pos: 0, color: start },
              ...(border ? [{ pos: border, color: start }] : []),
              { pos: 1, color: end },
            ];
      return { type: "gradient", shape: "linear", angle: css, stops: list };
    }
    return {
      type: "gradient",
      shape: "radial",
      angle: 0,
      stops: stops.length
        ? stops
        : [
            { pos: 0, color: end },
            { pos: 1 - border, color: start },
          ],
    };
  }
  if (kind === "bitmap") {
    const image = index.named("fill-image", p["fill-image-name"] ?? null);
    const id = index.image(image);
    return id ? { type: "image", image: id, tile: (p.repeat ?? "repeat") === "repeat" } : NO_FILL;
  }
  if (kind === "hatch")
    return p["fill-hatch-solid"] === "true"
      ? { type: "solid", color: p["fill-color"] ?? "#ffffff" }
      : NO_FILL;
  return undefined;
}

/** A line from graphic properties, or null for none. @param {Props} p @returns {Line | null} */
export function lineFrom(p) {
  if (!p.stroke || p.stroke === "none") return null;
  const color = p["stroke-color"] ?? "#3465a4";
  return {
    color: withAlpha(color, p["stroke-opacity"] ? Number.parseFloat(p["stroke-opacity"]) / 100 : 1),
    width: Math.max(0.5, length(p["stroke-width"], 0.75)),
    dash: p.stroke === "dash" ? "dash" : "solid",
    head: p["marker-start"] ? "triangle" : "none",
    tail: p["marker-end"] ? "triangle" : "none",
  };
}
