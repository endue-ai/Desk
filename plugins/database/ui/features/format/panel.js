// The Format SQL preview's DOM: the style in force in words, then the sample as Format lays it out,
// in the editor's monospace font, scrolling inside the panel when it is wider or longer than it.
// Colours and sizes come from the theme through format.css's classes.

import { el } from "../../dom.js";

/**
 * @typedef {import("../../sql/layout/style.js").Style} Style
 * @typedef {{ text: string, style: Style }} PreviewState
 */

const KEYWORDS = {
  upper: "keywords in upper case",
  lower: "keywords in lower case",
  preserve: "keywords as typed",
};
const ONE_LINE = {
  clause: "a clause a line when it fits",
  statement: "a statement a line when it fits",
  item: "an item a line",
};

/** The style in words, in the order the settings list it. */
export function styleWords(/** @type {Style} */ style) {
  return [
    KEYWORDS[style.keywordCase],
    `indent ${style.indent}`,
    `width ${style.lineWidth}`,
    `commas ${style.comma}`,
    `AND and OR ${style.andOr}`,
    style.joins === "flat" ? "joins under FROM" : "joins indented",
    ONE_LINE[style.oneLine],
    style.lists === "indent" ? "lists indented" : "lists aligned",
  ].join(" · ");
}

/**
 * @param {Document} doc
 * @param {PreviewState} state
 */
export function previewView(doc, state) {
  return el(
    doc,
    "section",
    { class: "format-preview", "aria-label": "Format SQL preview" },
    el(doc, "p", { class: "format-style" }, `PostgreSQL: ${styleWords(state.style)}.`),
    el(
      doc,
      "pre",
      { class: "format-sample", tabindex: "0", "aria-label": "The sample, formatted" },
      state.text,
    ),
    el(
      doc,
      "p",
      { class: "format-hint" },
      "The format settings of Database set the style; the sample is laid out again when one changes.",
    ),
  );
}
