// The deck model every reader produces and the one renderer draws. Lengths are points (1/72 inch)
// in the slide's frame: x right, y down. Colours are CSS colours. Nothing here touches the DOM.

/**
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ x: number, y: number, w: number, h: number, rot: number, flipH: boolean, flipV: boolean }} Box
 *   rot is degrees clockwise about the box's centre.
 * @typedef {{ left: number, top: number, right: number, bottom: number }} Crop  Fractions of the image.
 * @typedef {{ pos: number, color: string }} Stop  pos is 0..1.
 * @typedef {{ type: "none" }
 *   | { type: "solid", color: string }
 *   | { type: "gradient", shape: "linear" | "radial", angle: number, stops: Stop[] }
 *   | { type: "image", image: string, tile: boolean }} Fill
 *   A gradient's angle is CSS's: 0 points up, 90 right. An image is an id for Deck.image.
 * @typedef {"none" | "triangle" | "stealth" | "arrow" | "diamond" | "oval"} ArrowHead
 * @typedef {"solid" | "dot" | "dash" | "dashDot" | "longDash" | "longDashDot"} Dash
 * @typedef {{ color: string, width: number, dash: Dash, head: ArrowHead, tail: ArrowHead }} Line
 *   head is at the path's start, tail at its end.
 * @typedef {{ cmd: "M" | "L", x: number, y: number }
 *   | { cmd: "C", x1: number, y1: number, x2: number, y2: number, x: number, y: number }
 *   | { cmd: "Z" }} PathCommand
 * @typedef {{ w: number, h: number, fill: boolean, stroke: boolean, commands: PathCommand[] }} CustomPath
 *   A path in its own w x h frame, stretched over the shape's box.
 * @typedef {{ name: string, adjust: Record<string, number>, paths?: CustomPath[] }} Geometry
 *   A preset name (rect, roundRect, ellipse, ...) with its adjust values, or "custom" with paths.
 *
 * @typedef {{
 *   text: string, size: number, bold: boolean, italic: boolean, underline: boolean, strike: boolean,
 *   color: string, font: string, baseline: number, highlight?: string, lineBreak?: boolean
 * }} Run  size in points; baseline is a percentage (30 superscript, -25 subscript).
 * @typedef {{ text: string, color: string, font: string, size: number }} Bullet
 * @typedef {{
 *   runs: Run[], align: "left" | "center" | "right" | "justify", level: number,
 *   marginLeft: number, indent: number, bullet: Bullet | null,
 *   spaceBefore: number, spaceAfter: number, lineSpacing: number, lineExact: number, size: number
 * }} Paragraph  lineSpacing is a multiple of single spacing; lineExact, when not 0, is in points.
 *   size is the paragraph's own size, for an empty line.
 * @typedef {{
 *   paragraphs: Paragraph[], anchor: "top" | "middle" | "bottom",
 *   inset: { left: number, top: number, right: number, bottom: number },
 *   wrap: boolean, vertical: "horz" | "vert" | "vert270", scale: number, lineReduction: number
 * }} TextBody  scale is normAutofit's font scale (1 = none), already applied to the runs' sizes.
 *
 * @typedef {{ type: "shape", name: string, box: Box, geometry: Geometry, fill: Fill,
 *   line: Line | null, text: TextBody | null, placeholder: string }} ShapeElement
 *   placeholder is the placeholder's type (title, body, ...) or "".
 * @typedef {{ type: "picture", name: string, box: Box, image: string | null, crop: Crop,
 *   line: Line | null, geometry: Geometry, label: string }} PictureElement
 *   image is null when the picture is in a format the webview cannot draw; label names it.
 * @typedef {{ left: Line | null, top: Line | null, right: Line | null, bottom: Line | null }} Borders
 * @typedef {{ text: TextBody, fill: Fill, borders: Borders, colSpan: number, rowSpan: number,
 *   merged: boolean }} Cell  merged: covered by another cell's span, not drawn.
 * @typedef {{ height: number, cells: Cell[] }} Row
 * @typedef {{ type: "table", name: string, box: Box, columns: number[], rows: Row[] }} TableElement
 * @typedef {{ type: "group", name: string, box: Box, children: Element[] }} GroupElement
 *   Children's boxes are in the group's frame: 0,0 is the group's top left, in points.
 * @typedef {{ type: "placeholder", name: string, box: Box, label: string }} PlaceholderElement
 *   Something it does not draw (a chart, a video without a poster): a labelled box.
 * @typedef {ShapeElement | PictureElement | TableElement | GroupElement | PlaceholderElement} Element
 *
 * @typedef {{ number: number, title: string, hidden: boolean, background: Fill,
 *   elements: Element[], notes: string }} Slide
 * @typedef {{ format: string, size: Size, slides: Slide[], textOnly: boolean,
 *   image(id: string): Promise<string | null> }} Deck
 *   image resolves an id to a data: URL, decoding it the first time it is asked for.
 */

/** @param {Partial<Box>} [box] @returns {Box} */
export const boxOf = (box = {}) => ({
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  rot: 0,
  flipH: false,
  flipV: false,
  ...box,
});

/** @type {Fill} */
export const NO_FILL = { type: "none" };

/** @returns {Geometry} */
export const rect = () => ({ name: "rect", adjust: {} });

/**
 * A run with the defaults filled in.
 * @param {string} text
 * @param {Partial<Run>} [props]
 * @returns {Run}
 */
export const runOf = (text, props = {}) => ({
  text,
  size: 18,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "#000000",
  font: "",
  baseline: 0,
  ...props,
});

/**
 * A paragraph with the defaults filled in.
 * @param {Run[]} runs
 * @param {Partial<Paragraph>} [props]
 * @returns {Paragraph}
 */
export const paragraphOf = (runs, props = {}) => ({
  runs,
  align: "left",
  level: 0,
  marginLeft: 0,
  indent: 0,
  bullet: null,
  spaceBefore: 0,
  spaceAfter: 0,
  lineSpacing: 1,
  lineExact: 0,
  size: runs[0]?.size ?? 18,
  ...props,
});

/**
 * A text body with the defaults filled in.
 * @param {Paragraph[]} paragraphs
 * @param {Partial<TextBody>} [props]
 * @returns {TextBody}
 */
export const textOf = (paragraphs, props = {}) => ({
  paragraphs,
  anchor: "top",
  inset: { left: 7.2, top: 3.6, right: 7.2, bottom: 3.6 },
  wrap: true,
  vertical: "horz",
  scale: 1,
  lineReduction: 0,
  ...props,
});

/** The text of a body, one line per paragraph. @param {TextBody | null} body */
export const plainText = (body) =>
  (body?.paragraphs ?? []).map((p) => p.runs.map((r) => r.text).join("")).join("\n");

/**
 * A cache of image ids to data: URLs, decoded once on first use.
 * @param {(id: string) => Promise<string | null>} decode
 * @returns {(id: string) => Promise<string | null>}
 */
export function imageCache(decode) {
  /** @type {Map<string, Promise<string | null>>} */
  const cache = new Map();
  return (id) => {
    let found = cache.get(id);
    if (!found) {
      found = decode(id).catch(() => null);
      cache.set(id, found);
    }
    return found;
  };
}
