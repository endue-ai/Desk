// The dialog of what is sent to Eris (PG-90): the prompt exactly as it goes, before a connection's
// first ask (Send or Cancel) and whenever the person asks to read it (Keep or Close). A sample of
// the last result's rows is a tick the person makes; on a connection tagged production it waits
// until samples are turned on for that connection, and the prompt shown follows both ticks.
// Answers `{ sample, production }`; Cancel and Escape answer nothing (view-dialog.js).

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";

/** @typedef {import("./flow.js").SentModel} SentModel */

/**
 * @param {Document} doc
 * @param {SentModel} model
 * @param {(answer?: unknown) => void} done
 */
export function sentDialog(doc, model, done) {
  const box = (/** @type {string} */ name, /** @type {boolean} */ on) => {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name })
    );
    input.checked = on;
    return input;
  };
  const sample = box("sample", model.sample);
  const production = box("production", model.productionOn);
  const text = el(doc, "pre", {
    class: "assist-sent-text",
    tabindex: "0",
    "aria-label": t("features.assist.sentDialog.whatIsSent"),
  });
  const why = el(doc, "p", { class: "hint", role: "note" });
  const follow = () => {
    const allowed = !model.production || production.checked;
    sample.disabled = !model.withSample || !allowed;
    const shown = sample.checked && !sample.disabled;
    text.textContent = shown ? model.withSample : model.prompt;
    why.textContent = !model.withSample
      ? model.sampleWhy
      : !allowed
        ? t("features.assist.sentDialog.taggedProductionTurnSamplesOnFor")
        : shown
          ? t("features.assist.sentDialog.theSampleIsInWhatIs")
          : t("features.assist.sentDialog.noRowsOrValuesAreSent");
  };
  sample.addEventListener("change", follow);
  production.addEventListener("change", follow);
  follow();
  const first = model.mode === "first";
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    first ? t("features.assist.sentDialog.cancel") : t("features.assist.sentDialog.close"),
  );
  cancel.addEventListener("click", () => done());
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog wide assist-sent", "aria-labelledby": "assist-sent-title" },
      el(
        doc,
        "h2",
        { id: "assist-sent-title" },
        first
          ? t("features.assist.sentDialog.whatIsSentToEris")
          : t("features.assist.sentDialog.whatThisConsoleSendsToEris"),
      ),
      el(
        doc,
        "p",
        { class: "hint" },
        t("features.assist.sentDialog.theStatementTheErrorAndThe", {
          connection: String(model.connection),
        }),
      ),
      text,
      el(
        doc,
        "label",
        { class: "check" },
        sample,
        t("features.assist.sentDialog.sendASampleTheFirstRows"),
      ),
      model.production
        ? el(
            doc,
            "label",
            { class: "check" },
            production,
            t("features.assist.sentDialog.turnSamplesOnForThisProduction"),
          )
        : undefined,
      why,
      el(
        doc,
        "p",
        { class: "buttons" },
        cancel,
        el(
          doc,
          "button",
          { type: "submit", class: "desk-btn desk-btn-primary" },
          first ? t("features.assist.sentDialog.send") : t("features.assist.sentDialog.keep"),
        ),
      ),
    )
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    done({ sample: sample.checked, production: model.production && production.checked });
  });
  return form;
}
