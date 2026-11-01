// Text bodies as HTML: paragraphs with their alignment, margins, spacing and bullets, runs as spans
// with size, weight, style, decoration, colour and font. Text is set with textContent only, so it
// stays selectable and nothing from a file is ever parsed as HTML. A linked run is marked (links.js).
import { markLink } from "./links.js";

/**
 * @typedef {import("../deck.js").TextBody} TextBody
 * @typedef {import("../deck.js").Paragraph} Paragraph
 * @typedef {import("../deck.js").Run} Run
 */

/** A font stack: the file's font, then the desk's. @param {string} font */
export const fontStack = (font) =>
  font ? `"${font.replace(/["\\]/g, "")}", var(--slides-font)` : "var(--slides-font)";

/** @param {Document} doc @param {Run} run */
function span(doc, run) {
  if (run.lineBreak) return doc.createElement("br");
  const el = doc.createElement("span");
  el.textContent = run.text;
  const s = el.style;
  s.fontSize = `${run.size}px`;
  if (run.bold) s.fontWeight = "700";
  if (run.italic) s.fontStyle = "italic";
  const lines = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(
    Boolean,
  );
  if (lines.length) s.textDecoration = lines.join(" ");
  s.color = run.color;
  s.fontFamily = fontStack(run.font);
  if (run.baseline) {
    s.verticalAlign = run.baseline > 0 ? "super" : "sub";
    s.fontSize = `${run.size * 0.7}px`;
  }
  if (run.highlight) s.backgroundColor = run.highlight;
  const { link } = /** @type {Run & { link?: string }} */ (run);
  if (link) markLink(el, link);
  return el;
}

/** One paragraph. @param {Document} doc @param {Paragraph} p */
export function paragraphElement(doc, p) {
  const el = doc.createElement("p");
  const s = el.style;
  s.textAlign = p.align;
  s.fontSize = `${p.size}px`;
  if (p.marginLeft) s.paddingLeft = `${p.marginLeft}px`;
  if (p.indent) s.textIndent = `${p.indent}px`;
  if (p.spaceBefore) s.marginTop = `${p.spaceBefore}px`;
  if (p.spaceAfter) s.marginBottom = `${p.spaceAfter}px`;
  s.lineHeight = p.lineExact ? `${p.lineExact}px` : String(1.2 * p.lineSpacing);
  if (p.bullet) {
    const bullet = doc.createElement("span");
    bullet.className = "bullet";
    bullet.textContent = p.bullet.text;
    bullet.style.color = p.bullet.color;
    bullet.style.fontFamily = fontStack(p.bullet.font);
    bullet.style.fontSize = `${p.bullet.size}px`;
    if (p.indent < 0) bullet.style.minWidth = `${-p.indent}px`;
    else bullet.style.marginRight = "0.4em";
    bullet.setAttribute("aria-hidden", "true");
    el.append(bullet);
  }
  const runs = p.runs.filter((r) => r.text !== "" || r.lineBreak);
  for (const run of runs) el.append(span(doc, run));
  // An empty paragraph keeps its line.
  if (runs.length === 0 || runs.every((r) => r.lineBreak)) {
    const empty = doc.createElement("span");
    empty.textContent = "\u200b";
    empty.style.fontSize = `${p.size}px`;
    el.append(empty);
  }
  return el;
}

/**
 * A text body over a box: insets, vertical anchor, wrapping and direction.
 * @param {Document} doc @param {TextBody} body
 */
export function textElement(doc, body) {
  const el = doc.createElement("div");
  el.className = "text";
  const s = el.style;
  const { left, top, right, bottom } = body.inset;
  s.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  s.justifyContent =
    body.anchor === "middle" ? "center" : body.anchor === "bottom" ? "flex-end" : "flex-start";
  if (!body.wrap) s.whiteSpace = "pre";
  if (body.vertical !== "horz") {
    s.writingMode = "vertical-rl";
    if (body.vertical === "vert270") s.transform = "rotate(180deg)";
  }
  for (const p of body.paragraphs) el.append(paragraphElement(doc, p));
  return el;
}
