// The two pieces of the page that list an image's details: the rows of the details panel, and the
// card a file Images cannot show opens as (its name, why, and every row it has: a metafile's bounds
// and records, say). Text only ever goes in as text.

/**
 * @typedef {import("./details.js").ImageModel} ImageModel
 * @typedef {{ label: string, value: string }} Row
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

/** The details view: a card with the file's name, the reason, and its rows. */
export function notice(/** @type {Document} */ doc, /** @type {ImageModel} */ model) {
  const card = doc.createElement("div");
  card.className = "notice";
  const title = doc.createElement("h2");
  title.textContent = model.name;
  const reason = doc.createElement("p");
  reason.className = "reason";
  reason.textContent = model.reason ?? "";
  const list = doc.createElement("dl");
  list.append(...rows(doc, model.details));
  card.append(title, reason, list);
  return card;
}
