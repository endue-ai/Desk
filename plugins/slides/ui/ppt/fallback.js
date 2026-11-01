// A slide without a drawing (an outline-only entry): its title and body text from the
// SlideListWithText, laid out as a title over the body. No DOM.
import { boxOf, NO_FILL, paragraphOf, rect, runOf, textOf } from "../deck.js";
import { textOfAtom } from "./records.js";

/**
 * @typedef {import("../deck.js").Slide} Slide
 * @typedef {import("../deck.js").Box} Box
 * @typedef {import("./textbox.js").Outline} Outline
 */

/** A text shape of the layout. */
function shapeOf(
  /** @type {string} */ placeholder,
  /** @type {Box} */ box,
  /** @type {string[]} */ lines,
  /** @type {number} */ size,
) {
  const paragraphs = lines.map((line) =>
    paragraphOf([runOf(line, { size, bold: placeholder === "title" })]),
  );
  return /** @type {import("../deck.js").Element} */ ({
    type: "shape",
    name: placeholder === "title" ? "Title" : "Body",
    box,
    geometry: rect(),
    fill: NO_FILL,
    line: null,
    text: textOf(paragraphs, { anchor: placeholder === "title" ? "bottom" : "top" }),
    placeholder,
  });
}

/**
 * @param {Uint8Array} b @param {Outline[]} outline @param {number} number
 * @param {number} width @param {number} height @returns {Slide}
 */
export function fallbackSlide(b, outline, number, width, height) {
  const lines = (/** @type {(type: number) => boolean} */ pick) =>
    outline
      .filter((t) => pick(t.type))
      .flatMap((t) => {
        const atom = t.records.find((r) => textOfAtom(b, r) !== null);
        return (atom ? (textOfAtom(b, atom) ?? "") : "").split("\r");
      })
      .map((line) => line.replace(/\v/g, " ").trim())
      .filter((line) => line !== "" && line !== "*");
  const title = lines((t) => t === 0 || t === 6).slice(0, 1);
  const body = lines((t) => t !== 0 && t !== 6 && t !== 2);
  const titleBox = boxOf({ x: width * 0.06, y: height * 0.05, w: width * 0.88, h: height * 0.16 });
  const bodyBox = boxOf({ x: width * 0.06, y: height * 0.24, w: width * 0.88, h: height * 0.7 });
  const bodySize = Math.max(
    8,
    Math.min(Math.round(height * 0.044), bodyBox.h / (body.length * 1.45 || 1)),
  );
  return {
    number,
    title: title[0] ?? "",
    hidden: false,
    background: { type: "solid", color: "#ffffff" },
    elements: [
      shapeOf("title", titleBox, title, Math.round(height * 0.067)),
      shapeOf("body", bodyBox, body, bodySize),
    ],
    notes: "",
  };
}
