// One line of a run's Messages tab: its words, and the press beside it when it offers one (Allow
// connecting to a refused server, ADR 0335), which calls the action it names.

import { el } from "./dom.js";

/**
 * @param {Document} doc
 * @param {import("./tabs.js").Line} line
 * @param {(action: string, ...args: unknown[]) => unknown} act
 */
export function lineOf(doc, line, act) {
  const li = el(doc, "li", { class: `line ${line.level}` }, line.text);
  const offer = line.act;
  if (!offer) return li;
  const press = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet line-act" },
    offer.label,
  );
  press.addEventListener("click", () => act(offer.action, ...offer.args));
  li.append(" ", press);
  return li;
}
