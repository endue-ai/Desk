// The explorer's file and folder glyphs: line icons on a 24 grid, like the shell's (round caps and
// joins, the colour of the surrounding text). A glyph has an outline `body`, which style.css fills
// with a faint wash of its colour, and the `lines` drawn on or around it. The colour comes from the
// row's tone (file-icons.js) through style.css, never from here.

/**
 * @typedef {import("./file-icons.js").Glyph} Glyph
 * @typedef {import("./file-icons.js").Icon} Icon
 * @typedef {{ body?: string, lines?: string }} Shape
 */

const SVG = "http://www.w3.org/2000/svg";
/** A page with a folded corner, and the fold. */
const PAGE = "M13.5 3h-6A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-10z";
const FOLD = "M13.5 3v3.5a2 2 0 0 0 2 2H19";
const page = (/** @type {string} */ marks) => ({ body: PAGE, lines: `${FOLD}${marks}` });
const circle = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r) =>
  `M${x + r} ${y}a${r} ${r} 0 1 1-${2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0z`;
const FRAME = "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z";
const WIDE = "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z";
const TAB = "a2 2 0 0 1 2-2h3.9a1.5 1.5 0 0 1 1.2.6l1.2 1.6a1.5 1.5 0 0 0 1.2.6";

/** @type {Record<Glyph, Shape>} */
export const GLYPHS = {
  folder: { body: `M3 17.5v-11${TAB}H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z` },
  "folder-open": {
    body: "M3 17.5l2.6-5.8a1.5 1.5 0 0 1 1.4-.9h13.2a1 1 0 0 1 .95 1.3l-2.1 6.1a1.5 1.5 0 0 1-1.4 1H4.7A1.7 1.7 0 0 1 3 17.5z",
    lines: `M3 17.5v-11${TAB}H17a2 2 0 0 1 2 2v1.5`,
  },
  home: { body: "M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19z" },
  link: {
    lines:
      "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  },
  more: { lines: "M6 12h.01M12 12h.01M18 12h.01" },
  file: page(""),
  text: page("M9 13h6M9 16.5h4"),
  license: page("M9 14.5l2 2 4-4"),
  sheet: page("M8.5 12.5h7v5h-7zM8.5 15h7M12 12.5v5"),
  markdown: {
    body: "M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5z",
    lines: "M6.5 15V9L9 12l2.5-3v6M17 9v6M14.5 12.5L17 15l2.5-2.5",
  },
  readme: {
    body: "M12 7.5C12 5.6 10.4 4 8.5 4H3v14h6a3 3 0 0 1 3 3zM12 7.5C12 5.6 13.6 4 15.5 4H21v14h-6a3 3 0 0 0-3 3z",
  },
  code: { lines: "M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14" },
  style: { lines: "M5 9.5h15M4 14.5h15M10.5 4l-2 16M15.5 4l-2 16" },
  data: {
    lines:
      "M9 4H8a2 2 0 0 0-2 2v3.5a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 6 14.5V18a2 2 0 0 0 2 2h1" +
      "M15 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5V18a2 2 0 0 1-2 2h-1",
  },
  terminal: { body: FRAME, lines: "M7.5 9l3 3-3 3M12.5 15h4" },
  config: {
    lines: `M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1${circle(15, 6, 2)}${circle(9, 12, 2)}${circle(17, 18, 2)}`,
  },
  lock: {
    body: "M7 10.5h10a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2z",
    lines: "M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2",
  },
  key: { body: circle(8, 16, 3.5), lines: "M10.5 13.5L20 4M17 7l2.5 2.5M14.5 9.5l2 2" },
  git: {
    lines: `M7 3.5v12M17 9a6.5 6.5 0 0 1-6.5 6.5H7${circle(7, 18, 2.5)}${circle(17, 6.5, 2.5)}`,
  },
  package: { body: "M12 3l8 4.5v9L12 21l-8-4.5v-9z", lines: "M4 7.5l8 4.5 8-4.5M12 12v9" },
  image: { body: FRAME, lines: `${circle(9.5, 9.5, 1.75)}M20 15.5l-4-4L6.5 20` },
  video: { body: WIDE, lines: "M10 9.25v5.5l4.5-2.75z" },
  audio: {
    body: `${circle(6.5, 17.5, 2.5)}${circle(17.5, 15.5, 2.5)}`,
    lines: "M9 17.5V6l11-2v11.5",
  },
  archive: {
    body: "M4.5 8.5h15V18a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z",
    lines: "M4 4h16a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM10 12.5h4",
  },
  slides: {
    body: "M4.5 4h15v9.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z",
    lines: "M3 4h18M12 15.5V19M8.5 21l3.5-2 3.5 2",
  },
  font: { lines: "M5 7V5h14v2M12 5v14M9.5 19h5" },
  database: {
    body: "M4 6c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5v12c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5z",
    lines: "M20 6c0 1.4-3.6 2.5-8 2.5S4 7.4 4 6M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5",
  },
  book: {
    body: "M7.5 3H19v13.5H7.5A2.5 2.5 0 0 0 5 19V5.5A2.5 2.5 0 0 1 7.5 3z",
    lines: "M5 19a2.5 2.5 0 0 0 2.5 2.5H19v-5",
  },
};

/** One drawn glyph per document and name; rows get clones. */
const drawn = new WeakMap();

/**
 * An icon as an `<svg>`: hidden from assistive technology (the row's name says what it is), its
 * glyph and tone in `data-glyph` and `data-tone` for style.css.
 * @param {Document} doc
 * @param {Icon} icon
 * @returns {SVGSVGElement}
 */
export function drawIcon(doc, icon) {
  /** @type {Map<string, SVGSVGElement>} */
  let cache = drawn.get(doc);
  if (!cache) {
    cache = new Map();
    drawn.set(doc, cache);
  }
  let master = cache.get(icon.glyph);
  if (!master) {
    master = doc.createElementNS(SVG, "svg");
    for (const [name, value] of Object.entries({
      class: "icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.75",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
      "data-glyph": icon.glyph,
    }))
      master.setAttribute(name, value);
    const shape = GLYPHS[icon.glyph] ?? GLYPHS.file;
    for (const [part, d] of Object.entries(shape)) {
      const path = doc.createElementNS(SVG, "path");
      path.setAttribute("class", part);
      path.setAttribute("d", d);
      master.append(path);
    }
    cache.set(icon.glyph, master);
  }
  const svg = /** @type {SVGSVGElement} */ (master.cloneNode(true));
  svg.setAttribute("data-tone", icon.tone);
  return svg;
}
