// The options of a whole export (PG-64): the export's own fields for the format (features/export/
// dialog.js, filled with that format's last options), a line on what is read (every row the server
// has, in one snapshot) and, but for an .xlsx, gzip compression. Export… answers the options; the
// save dialog (one file) or the folder dialog (several) asks where next.

import { el } from "../../dom.js";
import { optionsDialog } from "../export/dialog.js";

/**
 * @typedef {import("../export/dialog.js").OptionsModel & { note: string, compress: boolean, compressible: boolean }} AllModel
 */

/**
 * @param {Document} doc
 * @param {AllModel} model
 * @param {(answer?: unknown) => void} done
 */
export function exportAllDialog(doc, model, done) {
  const box = /** @type {HTMLInputElement} */ (
    el(doc, "input", { type: "checkbox", class: "desk-check", name: "compress" })
  );
  box.checked = model.compress;
  const form = optionsDialog(doc, { ...model, rows: 0, partial: false, results: 0 }, (answer) =>
    done(
      answer
        ? { .../** @type {object} */ (answer), compress: model.compressible && box.checked }
        : undefined,
    ),
  );
  const title = form.querySelector("h2");
  if (title) title.textContent = `Export every row as ${model.label}`;
  const hint = form.querySelector(".hint");
  if (hint) hint.textContent = model.note;
  if (model.compressible)
    form
      .querySelector(".buttons")
      ?.before(el(doc, "label", { class: "check" }, box, " Compress with gzip (.gz)"));
  return form;
}
