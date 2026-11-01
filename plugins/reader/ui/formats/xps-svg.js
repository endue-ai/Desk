// One XPS FixedPage as SVG: Canvas as <g> (render transform, opacity, clip), Path as <path>
// (geometry, fill rule, solid, gradient and image brushes, strokes), Glyphs as <text> in the page's
// fonts. Resources resolve through {StaticResource} in scope. Every value is escaped: the SVG is
// written here, nothing from the file is copied through.
import { abbreviated, matrix, numbers, pathGeometry } from "./xps-geometry.js";

/**
 * @typedef {{ image(source: string): { href: string, width: number, height: number } | undefined,
 *   font(uri: string): string | undefined, dictionary(source: string): Element | undefined }} Assets
 */

const esc = (/** @type {string} */ s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attrs = (/** @type {Record<string, string | number | undefined>} */ map) =>
  Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
const num = (/** @type {number} */ n) => String(Math.round(n * 1000) / 1000);

/** An XPS colour (#AARRGGBB, #RRGGBB, sc#a,r,g,b) as an SVG colour and its opacity. */
export function color(/** @type {string | null} */ text) {
  const value = (text ?? "").trim();
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1];
  if (hex) {
    const argb = hex.length === 8 ? hex : `ff${hex}`;
    return {
      color: `#${argb.slice(2).toLowerCase()}`,
      opacity: Number.parseInt(argb.slice(0, 2), 16) / 255,
    };
  }
  const sc = /^sc#\s*(.*)$/i.exec(value)?.[1];
  if (sc) {
    const parts = numbers(sc);
    const [a, r, g, b] = parts.length === 4 ? parts : [1, ...parts];
    const channel = (/** @type {number | undefined} */ c) =>
      Math.round(Math.max(0, Math.min(1, c ?? 0)) ** (1 / 2.2) * 255);
    return { color: `rgb(${channel(r)},${channel(g)},${channel(b)})`, opacity: a ?? 1 };
  }
  return { color: "#000000", opacity: 1 };
}

const child = (/** @type {Element} */ el, /** @type {string} */ name) =>
  [...el.children].find((c) => c.localName === name);

/** @param {Element} page @param {Assets} assets @returns {{ svg: string, text: string }} */
export function pageToSvg(page, assets) {
  const width = Number(page.getAttribute("Width") ?? 816);
  const height = Number(page.getAttribute("Height") ?? 1056);
  const defs = [];
  const words = [];
  let ids = 0;
  const id = (/** @type {string} */ kind) => `${kind}${++ids}`;
  /** @type {Array<Map<string, Element>>} */
  const scopes = [];

  const pushResources = (/** @type {Element} */ el) => {
    const holder = [...el.children].find((c) => c.localName.endsWith(".Resources"));
    /** @type {Map<string, Element>} */
    const map = new Map();
    for (const dict of holder
      ? [...holder.children].filter((c) => c.localName === "ResourceDictionary")
      : []) {
      const source = dict.getAttribute("Source");
      const entries = source ? (assets.dictionary(source)?.children ?? []) : dict.children;
      for (const entry of entries) {
        const key =
          entry.getAttribute("x:Key") ??
          entry.getAttributeNS(
            "http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key",
            "Key",
          );
        if (key) map.set(key, entry);
      }
    }
    scopes.push(map);
  };
  const lookup = (/** @type {string | null} */ ref) => {
    const key = /^\{StaticResource\s+([^}\s]+)\s*\}$/.exec(ref ?? "")?.[1];
    if (!key) return undefined;
    for (let i = scopes.length - 1; i >= 0; i--) {
      const found = scopes[i]?.get(key);
      if (found) return found;
    }
    return undefined;
  };

  /** A brush as an SVG paint: a colour, or url(#id) to a gradient or pattern in defs. */
  const paint = (/** @type {Element} */ el, /** @type {string} */ property) => {
    const value = el.getAttribute(property);
    const brush = value
      ? lookup(value)
      : [...(child(el, `${el.localName}.${property}`)?.children ?? [])][0];
    if (value && !brush) {
      const c = color(value);
      return { paint: c.color, opacity: c.opacity };
    }
    if (!brush) return undefined;
    const opacity = Number(brush.getAttribute("Opacity") ?? 1);
    const transform = matrix(
      brush.getAttribute("Transform") ??
        child(
          child(brush, `${brush.localName}.Transform`) ?? brush,
          "MatrixTransform",
        )?.getAttribute("Matrix"),
    );
    switch (brush.localName) {
      case "SolidColorBrush": {
        const c = color(brush.getAttribute("Color"));
        return { paint: c.color, opacity: c.opacity * opacity };
      }
      case "LinearGradientBrush":
      case "RadialGradientBrush": {
        const stops = [...(child(brush, `${brush.localName}.GradientStops`)?.children ?? [])].map(
          (stop) => {
            const c = color(stop.getAttribute("Color"));
            return `<stop${attrs({ offset: stop.getAttribute("Offset") ?? "0", "stop-color": c.color, "stop-opacity": c.opacity < 1 ? num(c.opacity) : undefined })}/>`;
          },
        );
        const gid = id("g");
        const spread = { Reflect: "reflect", Repeat: "repeat" }[
          brush.getAttribute("SpreadMethod") ?? ""
        ];
        if (brush.localName === "LinearGradientBrush") {
          const [x1, y1] = numbers(brush.getAttribute("StartPoint"));
          const [x2, y2] = numbers(brush.getAttribute("EndPoint"));
          defs.push(
            `<linearGradient${attrs({ id: gid, gradientUnits: "userSpaceOnUse", x1, y1, x2, y2, spreadMethod: spread, gradientTransform: transform })}>${stops.join("")}</linearGradient>`,
          );
        } else {
          const [cx = 0, cy = 0] = numbers(brush.getAttribute("Center"));
          const [fx = cx, fy = cy] = numbers(brush.getAttribute("GradientOrigin"));
          const rx = Number(brush.getAttribute("RadiusX") ?? 1);
          const ry = Number(brush.getAttribute("RadiusY") ?? rx);
          const squash =
            rx && ry !== rx ? `matrix(1 0 0 ${num(ry / rx)} 0 ${num(cy - (cy * ry) / rx)})` : "";
          defs.push(
            `<radialGradient${attrs({ id: gid, gradientUnits: "userSpaceOnUse", cx, cy, r: rx, fx, fy, spreadMethod: spread, gradientTransform: [transform, squash].filter(Boolean).join(" ") })}>${stops.join("")}</radialGradient>`,
          );
        }
        return { paint: `url(#${gid})`, opacity };
      }
      case "ImageBrush": {
        const image = assets.image(brush.getAttribute("ImageSource") ?? "");
        if (!image) return undefined;
        const [vx = 0, vy = 0, vw = 1, vh = 1] = numbers(brush.getAttribute("Viewport"));
        const [bx = 0, by = 0, bw = image.width, bh = image.height] = numbers(
          brush.getAttribute("Viewbox"),
        );
        const pid = id("p");
        const view = `<svg${attrs({ width: vw, height: vh, viewBox: `${bx} ${by} ${bw} ${bh}`, preserveAspectRatio: "none" })}><image${attrs({ href: image.href, width: image.width, height: image.height, preserveAspectRatio: "none" })}/></svg>`;
        defs.push(
          `<pattern${attrs({ id: pid, patternUnits: "userSpaceOnUse", x: vx, y: vy, width: vw, height: vh, patternTransform: transform })}>${view}</pattern>`,
        );
        return { paint: `url(#${pid})`, opacity };
      }
      default:
        return undefined;
    }
  };

  /** The geometry of a Path's Data or Clip: the attribute, a resource or a property element. */
  const geometry = (/** @type {Element} */ el, /** @type {string} */ property) => {
    const value = el.getAttribute(property);
    const element = value
      ? lookup(value)
      : [...(child(el, `${el.localName}.${property}`)?.children ?? [])][0];
    if (element?.localName === "PathGeometry") {
      const parsed = pathGeometry(element);
      const transform = matrix(element.getAttribute("Transform"));
      return { ...parsed, transform };
    }
    return value && !element ? { ...abbreviated(value), transform: "" } : undefined;
  };

  /** Transform, opacity and clip, as SVG attributes for a <g> or a shape. */
  const common = (/** @type {Element} */ el) => {
    const transform = matrix(
      el.getAttribute("RenderTransform") ??
        child(child(el, `${el.localName}.RenderTransform`) ?? el, "MatrixTransform")?.getAttribute(
          "Matrix",
        ),
    );
    const opacity = el.getAttribute("Opacity");
    const clip = geometry(el, "Clip");
    let clipPath;
    if (clip?.d) {
      const cid = id("c");
      defs.push(
        `<clipPath${attrs({ id: cid })}><path${attrs({ d: clip.d, "clip-rule": clip.rule, transform: clip.transform })}/></clipPath>`,
      );
      clipPath = `url(#${cid})`;
    }
    return {
      transform,
      opacity: opacity && opacity !== "1" ? opacity : undefined,
      "clip-path": clipPath,
    };
  };

  /** @returns {string} */
  const walk = (/** @type {Element} */ el) => {
    switch (el.localName) {
      case "Canvas": {
        pushResources(el);
        const inner = [...el.children].map(walk).join("");
        scopes.pop();
        return `<g${attrs(common(el))}>${inner}</g>`;
      }
      case "Path": {
        const shape = geometry(el, "Data");
        if (!shape?.d) return "";
        const fill = paint(el, "Fill");
        const stroke = paint(el, "Stroke");
        const dash = numbers(el.getAttribute("StrokeDashArray"));
        const thickness = Number(el.getAttribute("StrokeThickness") ?? 1);
        const caps = { Round: "round", Square: "square", Flat: "butt", Triangle: "round" };
        const path = `<path${attrs({
          d: shape.d,
          "fill-rule": shape.rule,
          fill: fill?.paint ?? "none",
          "fill-opacity": fill && fill.opacity < 1 ? num(fill.opacity) : undefined,
          stroke: stroke?.paint,
          "stroke-opacity": stroke && stroke.opacity < 1 ? num(stroke.opacity) : undefined,
          "stroke-width": stroke ? thickness : undefined,
          "stroke-linejoin": stroke
            ? { Round: "round", Bevel: "bevel" }[el.getAttribute("StrokeLineJoin") ?? ""]
            : undefined,
          "stroke-linecap": stroke
            ? caps[/** @type {keyof typeof caps} */ (el.getAttribute("StrokeStartLineCap") ?? "")]
            : undefined,
          "stroke-dasharray":
            stroke && dash.length ? dash.map((d) => num(d * thickness)).join(" ") : undefined,
          transform: shape.transform,
        })}/>`;
        const outer = common(el);
        return outer.transform || outer.opacity || outer["clip-path"]
          ? `<g${attrs(outer)}>${path}</g>`
          : path;
      }
      case "Glyphs": {
        let text = el.getAttribute("UnicodeString") ?? "";
        if (text.startsWith("{}")) text = text.slice(2);
        if (!text) return "";
        words.push(text);
        const size = Number(el.getAttribute("FontRenderingEmSize") ?? 12);
        const x = Number(el.getAttribute("OriginX") ?? 0);
        const y = Number(el.getAttribute("OriginY") ?? 0);
        const advances = (el.getAttribute("Indices") ?? "").split(";").map((g) => {
          const advance = g.split(",")[1];
          return advance ? Number(advance) : undefined;
        });
        const known =
          advances.length >= text.length &&
          advances.slice(0, text.length).every((a) => a !== undefined && a > 0);
        let positions = num(x);
        if (known && !/[()]/.test(el.getAttribute("Indices") ?? "")) {
          let at = x;
          positions = [...text]
            .map((_, i) => {
              const here = at;
              at += ((advances[i] ?? 0) * size) / 100;
              return num(here);
            })
            .join(" ");
        }
        const fill = paint(el, "Fill");
        const simulations = el.getAttribute("StyleSimulations") ?? "";
        const family = assets.font(el.getAttribute("FontUri") ?? "");
        const glyph = `<text${attrs({
          x: positions,
          y: num(y),
          "font-size": num(size),
          "font-family": family ? `"${family}", serif` : "serif",
          "font-weight": simulations.includes("Bold") ? "bold" : undefined,
          "font-style": simulations.includes("Italic") ? "italic" : undefined,
          direction: Number(el.getAttribute("BidiLevel") ?? 0) % 2 ? "rtl" : undefined,
          fill: fill?.paint ?? "#000000",
          "fill-opacity": fill && fill.opacity < 1 ? num(fill.opacity) : undefined,
          "xml:space": "preserve",
        })}>${esc(text)}</text>`;
        const outer = common(el);
        return outer.transform || outer.opacity || outer["clip-path"]
          ? `<g${attrs(outer)}>${glyph}</g>`
          : glyph;
      }
      default:
        return "";
    }
  };

  pushResources(page);
  const body = [...page.children].map(walk).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${attrs({ viewBox: `0 0 ${num(width)} ${num(height)}`, width: num(width), height: num(height) })}><defs>${defs.join("")}</defs>${body}</svg>`;
  return { svg, text: words.join("\n") };
}
