// One slide as a box of its size in points: the background, then every element in drawing order.
// The caller scales the box with a CSS transform; the text inside stays real, selectable text.
import { elementOf } from "./elements.js";
import { paintFill } from "./paint.js";

/**
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Slide} Slide
 */

/** @param {Document} doc @param {Deck} deck @param {Slide} slide @returns {HTMLElement} */
export function renderSlide(doc, deck, slide) {
  const el = doc.createElement("div");
  el.className = "slide";
  el.style.width = `${deck.size.width}px`;
  el.style.height = `${deck.size.height}px`;
  paintFill(el, slide.background, deck);
  for (const element of slide.elements) {
    try {
      el.append(elementOf(doc, element, deck));
    } catch {
      // One element it cannot draw leaves a gap, not a broken slide.
    }
  }
  return el;
}
