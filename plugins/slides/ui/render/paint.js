// Fills as CSS backgrounds (solid, linear and radial gradients, pictures) and lines as SVG strokes
// with dashes and arrow heads.
import { arrowHead } from "../geometry.js";

/**
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("../deck.js").Line} Line
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../geometry.js").Drawn} Drawn
 */

const SVG = "http://www.w3.org/2000/svg";

/** A gradient's CSS. @param {Extract<Fill, { type: "gradient" }>} fill */
export function gradientCss(fill) {
  const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.pos * 1000) / 10}%`).join(", ");
  if (fill.shape === "radial") return `radial-gradient(ellipse at center, ${stops})`;
  return `linear-gradient(${Math.round(fill.angle * 100) / 100}deg, ${stops})`;
}

/**
 * Paint a fill on an element's background; a picture arrives when it is decoded.
 * @param {HTMLElement} el @param {Fill} fill @param {Deck} deck
 */
export function paintFill(el, fill, deck) {
  if (fill.type === "solid") el.style.backgroundColor = fill.color;
  else if (fill.type === "gradient") el.style.backgroundImage = gradientCss(fill);
  else if (fill.type === "image") {
    el.style.backgroundSize = fill.tile ? "auto" : "100% 100%";
    el.style.backgroundRepeat = fill.tile ? "repeat" : "no-repeat";
    void deck.image(fill.image).then((url) => {
      if (url) el.style.backgroundImage = `url("${url}")`;
    });
  }
}

/** @param {Line} line */
function dashArray(line) {
  const w = Math.max(line.width, 1);
  switch (line.dash) {
    case "dot":
      return `${w} ${w * 2}`;
    case "dash":
      return `${w * 4} ${w * 3}`;
    case "dashDot":
      return `${w * 4} ${w * 2} ${w} ${w * 2}`;
    case "longDash":
      return `${w * 8} ${w * 3}`;
    case "longDashDot":
      return `${w * 8} ${w * 3} ${w} ${w * 3}`;
    default:
      return "";
  }
}

/**
 * An SVG with the outline of drawn paths, and arrow heads at the ends of open ones.
 * @param {Document} doc @param {Drawn[]} drawn @param {Line} line @param {number} w @param {number} h
 */
export function strokeSvg(doc, drawn, line, w, h) {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "stroke");
  svg.setAttribute("width", String(Math.max(w, 1)));
  svg.setAttribute("height", String(Math.max(h, 1)));
  svg.setAttribute("aria-hidden", "true");
  for (const d of drawn) {
    if (!d.stroke) continue;
    const path = doc.createElementNS(SVG, "path");
    path.setAttribute("d", d.d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", line.color);
    path.setAttribute("stroke-width", String(line.width));
    path.setAttribute("stroke-linejoin", "round");
    const dash = dashArray(line);
    if (dash) path.setAttribute("stroke-dasharray", dash);
    svg.append(path);
    for (const [end, kind] of /** @type {const} */ ([
      [d.start, line.head],
      [d.end, line.tail],
    ])) {
      if (!end || kind === "none") continue;
      const head = doc.createElementNS(SVG, "path");
      head.setAttribute("d", arrowHead(end, kind, line.width));
      head.setAttribute("fill", line.color);
      svg.append(head);
    }
  }
  return svg;
}
