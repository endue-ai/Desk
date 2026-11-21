// The dialog of EXPLAIN's options (PG-70), the plans feature's: a toggle per option the server's
// version has, each with what it adds; what ANALYZE does to a write said under it; an option that
// needs ANALYZE off without it and GENERIC_PLAN off with it. Explain answers with the options on,
// Cancel and Escape with nothing (view-dialog.js).

import { el } from "../../dom.js";

/**
 * @typedef {{ name: string, hint: string, needs?: "ANALYZE", not?: "ANALYZE" }} Shown
 * @typedef {{ connection: string, version: number, options: Shown[], on: string[] }} OptionsModel
 */

/** "PostgreSQL 17" from 170012. */
const release = (/** @type {number} */ version) => `PostgreSQL ${Math.floor(version / 10000)}`;

export const SAFETY =
  "ANALYZE runs the statement. A write runs inside a transaction that is rolled back, and still passes the connection's read-only, production and agent guards.";

/**
 * @param {Document} doc
 * @param {OptionsModel} model
 * @param {(answer?: unknown) => void} done
 */
export function optionsDialog(doc, model, done) {
  const on = new Set(model.on);
  /** @type {Map<string, HTMLInputElement>} */
  const boxes = new Map();
  const rows = model.options.map((option) => {
    const box = /** @type {HTMLInputElement} */ (
      el(doc, "input", {
        type: "checkbox",
        class: "desk-check",
        name: option.name,
        ...(option.name === "ANALYZE" ? { "aria-describedby": "plan-options-safety" } : {}),
      })
    );
    box.checked = on.has(option.name);
    boxes.set(option.name, box);
    const rule = option.needs ? " · needs ANALYZE" : option.not ? " · not with ANALYZE" : "";
    return el(
      doc,
      "label",
      { class: "check plan-option" },
      box,
      el(doc, "span", { class: "plan-option-name" }, option.name),
      el(doc, "span", { class: "hint" }, `${option.hint}${rule}`),
    );
  });
  const analyze = boxes.get("ANALYZE");
  /** Options that need ANALYZE follow it; GENERIC_PLAN goes the other way. */
  const follow = () => {
    const analyzing = analyze?.checked ?? false;
    for (const option of model.options) {
      const box = boxes.get(option.name);
      if (!box) continue;
      box.disabled =
        (option.needs === "ANALYZE" && !analyzing) || (option.not === "ANALYZE" && analyzing);
    }
  };
  analyze?.addEventListener("change", follow);
  follow();
  const cancel = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet" }, "Cancel");
  cancel.addEventListener("click", () => done());
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog plan-options", "aria-labelledby": "plan-options-title" },
      el(doc, "h2", { id: "plan-options-title" }, "Explain with options"),
      el(
        doc,
        "p",
        { class: "hint" },
        `${model.connection} · ${release(model.version)} · remembered for this connection`,
      ),
      el(
        doc,
        "fieldset",
        { class: "plan-option-list" },
        el(doc, "legend", { class: "sr-only" }, "Options"),
        ...rows,
      ),
      el(doc, "p", { class: "hint plan-safety", id: "plan-options-safety", role: "note" }, SAFETY),
      el(
        doc,
        "p",
        { class: "buttons" },
        cancel,
        el(doc, "button", { type: "submit", class: "desk-btn desk-btn-primary" }, "Explain"),
      ),
    )
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // An option off for now (it needs ANALYZE) stays on for the next time it applies.
    done([...boxes].filter(([, box]) => box.checked).map(([name]) => name));
  });
  return form;
}
