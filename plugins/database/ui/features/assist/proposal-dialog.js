// The dialog of Eris's proposal (PG-90): what Eris says, the text that would go into the console
// in a field the person may change, its marks (a write, a schema change, what a read-only or a
// production connection does with it) drawn again as the text changes, the server's check, and
// what was sent. "Put in the console" answers `{ text }` with the field's text; "Put aside",
// Escape and Cancel answer nothing (view-dialog.js). Nothing here runs.

import { el } from "../../dom.js";
import { marksOf } from "./check.js";

/** @typedef {import("./flow.js").ProposalModel} ProposalModel */

/**
 * @param {Document} doc
 * @param {ProposalModel} model
 * @param {(answer?: unknown) => void} done
 */
export function proposalDialog(doc, model, done) {
  const field = /** @type {HTMLTextAreaElement} */ (
    el(doc, "textarea", {
      class: "assist-text",
      name: "text",
      spellcheck: "false",
      "aria-label": "Proposal",
      rows: "8",
    })
  );
  field.value = model.text;
  const marks = el(doc, "ul", { class: "assist-marks", "aria-label": "Marks" });
  const server = el(doc, "p", { class: `hint assist-server assist-${model.server.state}` });
  const draw = () => {
    const now = field.value === model.text ? model : { ...model, ...marksOf(model, field.value) };
    marks.replaceChildren(
      ...(now.marks.length ? now.marks : ["Reads only."]).map((m) =>
        el(doc, "li", { class: now.write ? "assist-write" : "" }, m),
      ),
    );
    server.textContent =
      field.value === model.text ? model.server.text : "Changed since the server checked it.";
  };
  field.addEventListener("input", draw);
  draw();
  const sent = el(
    doc,
    "details",
    { class: "assist-sent-box" },
    el(doc, "summary", {}, "What was sent"),
    el(doc, "pre", { class: "assist-sent-text", tabindex: "0" }, model.sent),
  );
  const aside = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    "Put aside",
  );
  aside.addEventListener("click", () => done());
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog wide assist-proposal", "aria-labelledby": "assist-proposal-title" },
      el(doc, "h2", { id: "assist-proposal-title" }, model.title),
      el(doc, "p", { class: "hint" }, `${model.connection} · nothing runs until you run it`),
      model.explanation
        ? el(doc, "p", { class: "assist-explanation" }, model.explanation)
        : undefined,
      field,
      marks,
      server,
      sent,
      el(
        doc,
        "p",
        { class: "buttons" },
        aside,
        el(
          doc,
          "button",
          { type: "submit", class: "desk-btn desk-btn-primary" },
          "Put in the console",
        ),
      ),
    )
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    done({ text: field.value });
  });
  return form;
}
