// The two pieces of the page that list an image's details: the rows of the details panel, and the
// card a file Images cannot show opens as (its name, why, Show in Finder for another app, and every
// row it has: a metafile's bounds and records, say). Text only ever goes in as text.
import { revealLabel } from "./reveal.js";

/**
 * @typedef {import("./details.js").ImageModel} ImageModel
 * @typedef {{ label: string, value: string }} Row
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** Term and description elements for each row. */
export function rows(/** @type {Document} */ doc, /** @type {Row[]} */ list) {
  return list.flatMap(({ label, value }) => {
    const dt = doc.createElement("dt");
    dt.textContent = label;
    const dd = doc.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  });
}

/** The details view: a card with the file's name, the reason, Show in Finder, and its rows. */
export function notice(
  /** @type {Document} */ doc,
  /** @type {ImageModel} */ model,
  /** @type {Act} */ act = () => {},
) {
  const card = doc.createElement("div");
  card.className = "notice";
  const title = doc.createElement("h2");
  title.textContent = model.name;
  const reason = doc.createElement("p");
  reason.className = "reason";
  reason.textContent = model.reason ?? "";
  const elsewhere = doc.createElement("p");
  elsewhere.className = "elsewhere";
  const show = doc.createElement("button");
  show.type = "button";
  show.className = "desk-btn";
  show.textContent = revealLabel(doc.defaultView?.navigator.platform);
  show.addEventListener("click", () => act("reveal", model));
  elsewhere.append(show);
  const list = doc.createElement("dl");
  list.append(...rows(doc, model.details));
  card.append(title, reason, elsewhere, list);
  return card;
}
