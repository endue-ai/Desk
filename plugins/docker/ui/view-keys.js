// The keys card `?` and its button open: every labelled key of where the keys are. Escape closes
// it before anything else hears that Escape, wherever the focus is (the list, the pane, the header's
// button), and `?` again closes it too.

import { el } from "./dom.js";
import { keyTable } from "./keys.js";

/**
 * @typedef {import("./keys.js").ViewName} ViewName
 */

/**
 * @param {Document} doc
 * @param {{ card: HTMLElement, button: HTMLElement, title(where: ViewName): string }} parts
 */
export function createKeysCard(doc, { card, button, title }) {
  const draw = (/** @type {ViewName} */ where) =>
    card.replaceChildren(
      el(doc, "h2", {}, `Keys: ${title(where)}`),
      el(
        doc,
        "dl",
        {},
        ...keyTable(where).flatMap(([key, what]) => [
          el(doc, "dt", {}, el(doc, "kbd", {}, String(key))),
          el(doc, "dd", {}, String(what)),
        ]),
      ),
    );

  const set = (/** @type {boolean} */ open, /** @type {ViewName} */ where) => {
    card.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) draw(where);
  };

  const self = {
    open: () => !card.hidden,
    toggle: (/** @type {ViewName} */ where) => set(card.hidden, where),
    /** The keys moved to another place: the open card follows them. */
    follow(/** @type {ViewName} */ where) {
      if (!card.hidden) draw(where);
    },
    /** Escape while the card is open is the card's: true when it closed it. */
    escape(/** @type {KeyboardEvent} */ event) {
      if (event.key !== "Escape" || card.hidden || event.defaultPrevented) return false;
      event.preventDefault();
      card.hidden = true;
      button.setAttribute("aria-expanded", "false");
      return true;
    },
  };
  // Keys outside the list and the pane (the header's button has the focus after a click on it).
  doc.addEventListener("keydown", (event) => void self.escape(event));
  return self;
}
