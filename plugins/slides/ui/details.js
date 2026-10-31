// What shows instead of slides: the details view (name, size, format and why), a Keynote package's
// preview image, or a Google Slides shortcut's card with its address as selectable text.
import { sizeText } from "./bytes.js";

/** @typedef {import("./slides.js").Shown} Shown */

/** @param {Document} doc @param {HTMLElement} section @param {Shown} model */
export function renderDetails(doc, section, model) {
  const { opened } = model;
  const heading = doc.createElement("h2");
  heading.id = "details-name";
  heading.textContent = model.name;
  const facts = doc.createElement("dl");
  for (const [term, value] of [
    ["Size", sizeText(model.size)],
    ["Format", opened.format],
    ["Path", model.path],
  ]) {
    const dt = doc.createElement("dt");
    dt.textContent = term ?? "";
    const dd = doc.createElement("dd");
    dd.textContent = value ?? "";
    facts.append(dt, dd);
  }
  const why = doc.createElement("p");
  why.className = "why";
  why.textContent =
    opened.kind === "details" ? opened.reason : opened.kind === "deck" ? "" : opened.sentence;
  section.replaceChildren(heading, why, facts);
  if (opened.kind === "card") {
    const label = doc.createElement("p");
    label.className = "label";
    label.textContent = "Address in Google Slides";
    const url = doc.createElement("p");
    url.className = "url";
    url.textContent = opened.url;
    section.append(label, url);
  }
  if (opened.kind === "preview") {
    for (const src of opened.images) {
      const img = doc.createElement("img");
      img.className = "preview";
      img.alt = `Preview of ${model.name}`;
      img.src = src;
      section.append(img);
    }
  }
}
