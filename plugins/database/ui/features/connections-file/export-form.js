// The export dialog (PG-15): every connection with its checkbox (those asked for ticked), All and
// None, and what the file holds and never holds. Export answers the ticked ids; Cancel and Escape
// nothing; nothing ticked holds the button.

import { el } from "../../dom.js";
import { checkRow, pickList } from "./pick-list.js";

/**
 * @param {Document} doc
 * @param {import("./transfer.js").ExportModel} model
 * @param {(answer?: unknown) => void} done
 */
export function exportDialog(doc, model, done) {
  const wanted = new Set(model.ticked);
  const rows = model.connections.map((c) =>
    checkRow(
      doc,
      { value: c.id, name: c.name, on: wanted.has(c.id) },
      el(doc, "span", { class: "connections-detail" }, c.detail),
    ),
  );
  const submit = /** @type {HTMLButtonElement} */ (
    el(doc, "button", { type: "submit", class: "desk-btn desk-btn-primary" }, "Export…")
  );
  const list = pickList(doc, {
    label: "Connections",
    rows,
    count: (n) => `${n} of ${rows.length} to export`,
    follow: () => {
      submit.disabled = list.ticks() === 0;
    },
  });
  const cancel = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet" }, "Cancel");
  cancel.addEventListener("click", () => done());
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog connections-file", "aria-labelledby": "connections-export-title" },
      el(doc, "h2", { id: "connections-export-title" }, "Export connections"),
      el(
        doc,
        "p",
        { class: "hint" },
        "The file holds each connection's server, database, user, group, colour, environment and options. No password, passphrase or keychain entry goes into it.",
      ),
      list.node,
      el(doc, "p", { class: "buttons" }, cancel, submit),
    )
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ids = rows.filter((r) => r.box.checked).map((r) => r.box.value);
    if (ids.length) done({ ids });
  });
  list.update();
  return form;
}
