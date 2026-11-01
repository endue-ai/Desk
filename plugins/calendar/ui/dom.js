// Building the calendar's DOM: elements with text that only ever goes in through textContent, and
// the button every event is drawn as, named in full for screen readers.
import { banner } from "./calendar/layout.js";
import { eventText, timeText } from "./format.js";

/** @typedef {import("./calendar/model.js").Occurrence} Occurrence */

/**
 * Make an element with attributes and children; strings become text.
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, string | number | boolean | undefined>} [attrs]
 * @param {Array<Node | string | undefined | false>} [children]
 */
export function h(doc, tag, attrs = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === "class") el.className = String(value);
    else if (name === "text") el.textContent = String(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/**
 * A button for one event: its title, its time when it has one, named in full. A click opens it.
 * @param {Document} doc
 * @param {string} locale
 * @param {Occurrence} occ
 * @param {(id: string) => void} open
 * @param {string} [extra] more classes
 * @param {boolean} [withTime]
 */
export function eventButton(doc, locale, occ, open, extra = "", withTime = true) {
  const label = eventText(locale, occ);
  const time = withTime && !banner(occ) ? timeText(locale, occ.startWall) : "";
  const button = h(
    doc,
    "button",
    {
      type: "button",
      class: `event ${extra}`.trim(),
      "data-id": occ.id,
      "data-status": occ.status.toLowerCase(),
      "data-free": occ.free,
      "aria-label": label,
      title: label,
    },
    [
      time && h(doc, "span", { class: "time", text: time }),
      h(doc, "span", { class: "title", text: occ.title }),
    ],
  );
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    open(occ.id);
  });
  return button;
}
