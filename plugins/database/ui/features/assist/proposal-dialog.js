// The dialog of Eris's proposal (PG-90): what Eris says, the text that would go into the console
// in a field the person may change, its marks (a write, a schema change, what a read-only or a
// production connection does with it) drawn again as the text changes, the server's check, and
// what was sent. "Put in the console" answers `{ text }` with the field's text; "Put aside",
// Escape and Cancel answer nothing (view-dialog.js). Nothing here runs.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";
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
      "aria-label": t("features.assist.proposalDialog.proposal"),
      rows: "8",
    })
  );
  field.value = model.text;
  const marks = el(doc, "ul", {
    class: "assist-marks",
    "aria-label": t("features.assist.proposalDialog.marks"),
  });
  const server = el(doc, "p", { class: `hint assist-server assist-${model.server.state}` });
  const draw = () => {
    const now = field.value === model.text ? model : { ...model, ...marksOf(model, field.value) };
    marks.replaceChildren(
      ...(now.marks.length ? now.marks : [t("features.assist.proposalDialog.readsOnly")]).map((m) =>
        el(doc, "li", { class: now.write ? "assist-write" : "" }, m),
      ),
    );
    server.textContent =
      field.value === model.text
        ? model.server.text
        : t("features.assist.proposalDialog.changedSinceTheServerCheckedIt");
  };
  field.addEventListener("input", draw);
  draw();
  const sent = el(
    doc,
    "details",
    { class: "assist-sent-box" },
    el(doc, "summary", {}, t("features.assist.proposalDialog.whatWasSent")),
    el(doc, "pre", { class: "assist-sent-text", tabindex: "0" }, model.sent),
  );
  const aside = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    t("features.assist.proposalDialog.putAside"),
  );
  aside.addEventListener("click", () => done());
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog wide assist-proposal", "aria-labelledby": "assist-proposal-title" },
      el(doc, "h2", { id: "assist-proposal-title" }, model.title),
      el(
        doc,
        "p",
        { class: "hint" },
        t("features.assist.proposalDialog.nothingRunsUntilYouRunIt", {
          connection: String(model.connection),
        }),
      ),
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
          t("features.assist.proposalDialog.putInTheConsole"),
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
