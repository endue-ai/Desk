// Slide elements as absolutely positioned HTML in the slide's points: shapes (a CSS fill clipped to
// the geometry, an SVG outline, the text on top), pictures with crop, tables, groups and the boxes
// of what is not drawn.
import { drawGeometry } from "../geometry.js";
import { paintFill, strokeSvg } from "./paint.js";
import { paragraphElement, textElement } from "./text.js";

/**
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Element} SlideElement
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("../deck.js").Line} Line
 */

/** @param {Document} doc @param {string} className */
const div = (doc, className) => {
  const el = doc.createElement("div");
  el.className = className;
  return el;
};

/** Place an element at its box, turned about its centre. @param {HTMLElement} el @param {Box} box */
function place(el, box) {
  const s = el.style;
  s.left = `${box.x}px`;
  s.top = `${box.y}px`;
  s.width = `${box.w}px`;
  s.height = `${box.h}px`;
  if (box.rot) s.transform = `rotate(${box.rot}deg)`;
}

/** The mirror transform of a flipped box, for the layers that flip (not the text). @param {Box} box */
const mirror = (box) =>
  box.flipH || box.flipV ? `scale(${box.flipH ? -1 : 1}, ${box.flipV ? -1 : 1})` : "";

/** @param {Document} doc @param {Extract<SlideElement, { type: "shape" }>} shape @param {Deck} deck */
function shapeElement(doc, shape, deck) {
  const el = div(doc, "el shape");
  place(el, shape.box);
  const { w, h } = shape.box;
  const drawn = drawGeometry(shape.geometry, w, h);
  const flip = mirror(shape.box);
  const filled = drawn.filter((d) => d.fill);
  if (shape.fill.type !== "none" && filled.length) {
    const fill = div(doc, "fill");
    paintFill(fill, shape.fill, deck);
    if (shape.geometry.name !== "rect")
      fill.style.clipPath = `path("${filled.map((d) => d.d).join(" ")}")`;
    if (flip) fill.style.transform = flip;
    el.append(fill);
  }
  if (shape.line) {
    const svg = strokeSvg(doc, drawn, shape.line, w, h);
    if (flip) svg.style.transform = flip;
    el.append(svg);
  }
  if (shape.text?.paragraphs.length) {
    const text = textElement(doc, shape.text);
    // A vertically flipped shape turns its text upside down, as PowerPoint draws it.
    if (shape.box.flipV) text.style.transform = `${text.style.transform} rotate(180deg)`.trim();
    el.append(text);
  }
  return el;
}

/** @param {Document} doc @param {Extract<SlideElement, { type: "picture" }>} picture @param {Deck} deck */
function pictureElement(doc, picture, deck) {
  const el = div(doc, "el picture");
  place(el, picture.box);
  const { w, h } = picture.box;
  if (picture.geometry.name !== "rect") {
    const drawn = drawGeometry(picture.geometry, w, h).filter((d) => d.fill);
    if (drawn.length) el.style.clipPath = `path("${drawn.map((d) => d.d).join(" ")}")`;
  }
  const missing = () => {
    el.classList.add("missing");
    el.textContent = picture.label;
  };
  if (!picture.image) missing();
  else {
    const img = doc.createElement("img");
    img.alt = picture.label;
    img.draggable = false;
    const { left, top, right, bottom } = picture.crop;
    const cw = 1 - left - right || 1;
    const ch = 1 - top - bottom || 1;
    img.style.width = `${100 / cw}%`;
    img.style.height = `${100 / ch}%`;
    img.style.left = `${(-left / cw) * 100}%`;
    img.style.top = `${(-top / ch) * 100}%`;
    if (mirror(picture.box)) img.style.transform = mirror(picture.box);
    el.append(img);
    void deck.image(picture.image).then((url) => {
      if (url) img.src = url;
      else {
        img.remove();
        missing();
      }
    });
  }
  if (picture.line)
    el.append(strokeSvg(doc, drawGeometry(picture.geometry, w, h), picture.line, w, h));
  return el;
}

/** A border as CSS. @param {Line | null} line */
const border = (line) =>
  line ? `${line.width}px ${line.dash === "solid" ? "solid" : "dashed"} ${line.color}` : "none";

/** @param {Document} doc @param {Extract<SlideElement, { type: "table" }>} table @param {Deck} deck */
function tableElement(doc, table, deck) {
  const el = div(doc, "el table");
  place(el, table.box);
  el.style.height = "auto";
  const t = doc.createElement("table");
  const colgroup = doc.createElement("colgroup");
  for (const width of table.columns) {
    const col = doc.createElement("col");
    col.style.width = `${width}px`;
    colgroup.append(col);
  }
  t.append(colgroup);
  t.style.width = `${table.columns.reduce((a, b) => a + b, 0) || table.box.w}px`;
  const body = doc.createElement("tbody");
  for (const row of table.rows) {
    const tr = doc.createElement("tr");
    tr.style.height = `${row.height}px`;
    for (const cell of row.cells) {
      if (cell.merged) continue;
      const td = doc.createElement("td");
      if (cell.colSpan > 1) td.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
      paintFill(td, cell.fill, deck);
      const s = td.style;
      s.borderLeft = border(cell.borders.left);
      s.borderRight = border(cell.borders.right);
      s.borderTop = border(cell.borders.top);
      s.borderBottom = border(cell.borders.bottom);
      const { left, top, right, bottom } = cell.text.inset;
      s.padding = `${top}px ${right}px ${bottom}px ${left}px`;
      s.verticalAlign =
        cell.text.anchor === "middle" ? "middle" : cell.text.anchor === "bottom" ? "bottom" : "top";
      for (const p of cell.text.paragraphs) td.append(paragraphElement(doc, p));
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(body);
  el.append(t);
  return el;
}

/**
 * One element, and a group's children inside it.
 * @param {Document} doc @param {SlideElement} element @param {Deck} deck
 * @returns {HTMLElement}
 */
export function elementOf(doc, element, deck) {
  switch (element.type) {
    case "shape":
      return shapeElement(doc, element, deck);
    case "picture":
      return pictureElement(doc, element, deck);
    case "table":
      return tableElement(doc, element, deck);
    case "group": {
      const el = div(doc, "el group");
      place(el, element.box);
      if (mirror(element.box))
        el.style.transform = `${el.style.transform} ${mirror(element.box)}`.trim();
      for (const child of element.children) el.append(elementOf(doc, child, deck));
      return el;
    }
    default: {
      const el = div(doc, "el missing");
      place(el, element.box);
      el.textContent = element.label;
      return el;
    }
  }
}
