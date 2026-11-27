// The dialog of every privileges change (PG-54): where it runs (the connection and its environment
// tag), its fields (a password in a hidden field) and choices, the notes, and the exact script,
// written again (script.js) as the person types, a password masked. A script the answers cannot
// make says why in its place and the run button waits. Run answers the fields' values and the
// choices on; Cancel and Escape answer nothing (view-dialog.js).

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";
import { scriptOf } from "./script.js";

/**
 * @typedef {import("./models.js").ChangeModel} ChangeModel
 * @typedef {import("./models.js").Field} Field
 */

/** One field: a line, a hidden line, a list to pick from, or a box of lines. */
function fieldOf(/** @type {Document} */ doc, /** @type {Field} */ field) {
  const id = `privileges-field-${field.name}`;
  /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */
  let input;
  if (field.kind === "select")
    input = /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        { id, name: field.name, class: "desk-field" },
        ...(field.options ?? []).map((o) => el(doc, "option", { value: o }, o)),
      )
    );
  else if (field.kind === "textarea")
    input = /** @type {HTMLTextAreaElement} */ (
      el(doc, "textarea", {
        id,
        name: field.name,
        class: "desk-field",
        rows: "2",
        spellcheck: "false",
      })
    );
  else
    input = /** @type {HTMLInputElement} */ (
      el(doc, "input", {
        id,
        name: field.name,
        class: "desk-field",
        spellcheck: "false",
        ...(field.kind === "password"
          ? { type: "password", autocomplete: "new-password" }
          : { autocomplete: "off" }),
        ...(field.list?.length ? { list: `${id}-list` } : {}),
      })
    );
  input.value = field.value;
  const list = field.list?.length
    ? el(
        doc,
        "datalist",
        { id: `${id}-list` },
        ...field.list.map((v) => el(doc, "option", { value: v })),
      )
    : undefined;
  const label = el(
    doc,
    "label",
    { class: "privileges-field", for: id },
    el(doc, "span", {}, field.label),
    input,
    list,
    field.hint ? el(doc, "span", { class: "hint" }, field.hint) : undefined,
  );
  return { label, input };
}

/**
 * @param {Document} doc
 * @param {ChangeModel} model
 * @param {(answer?: unknown) => void} done
 */
export function privilegesDialog(doc, model, done) {
  const fields = model.fields.map((field) => fieldOf(doc, field));
  /** @type {Map<string, HTMLInputElement>} */
  const boxes = new Map();
  const choices = model.choices.map((choice) => {
    const box = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name: choice.name })
    );
    box.checked = choice.checked;
    box.disabled = choice.disabled === true;
    boxes.set(choice.name, box);
    return el(
      doc,
      "label",
      { class: "check privileges-choice" },
      box,
      el(doc, "span", { class: "privileges-choice-name" }, choice.label),
      el(doc, "span", { class: "hint" }, choice.hint),
    );
  });
  const script = el(doc, "pre", {
    class: "privileges-script",
    id: "privileges-script",
    tabindex: "0",
    "aria-live": "polite",
  });
  const problem = el(doc, "p", { class: "privileges-problem", role: "alert" });
  const run = /** @type {HTMLButtonElement} */ (
    el(
      doc,
      "button",
      {
        type: "submit",
        class: `desk-btn ${model.danger ? "desk-btn-danger" : "desk-btn-primary"}`,
      },
      model.run,
    )
  );
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    t("features.privileges.dialog.cancel"),
  );
  cancel.addEventListener("click", () => done());

  const answers = () => ({
    values: Object.fromEntries(model.fields.map((f, i) => [f.name, fields[i]?.input.value ?? ""])),
    choices: [...boxes].filter(([, box]) => box.checked && !box.disabled).map(([name]) => name),
  });
  /** Write the script from the answers (a password masked), or say why there is none. */
  const update = () => {
    try {
      script.textContent = scriptOf(model, answers());
      problem.textContent = "";
      problem.hidden = true;
      run.disabled = false;
    } catch (error) {
      script.textContent = "";
      problem.textContent = error instanceof Error ? error.message : String(error);
      problem.hidden = false;
      run.disabled = true;
    }
  };

  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog privileges-change", "aria-labelledby": "privileges-title" },
      el(doc, "h2", { id: "privileges-title" }, model.title),
      el(
        doc,
        "p",
        { class: "hint privileges-where" },
        model.where,
        model.tag ? el(doc, "span", { class: `tag tag-${model.tag}` }, model.tag) : undefined,
      ),
      ...fields.map((f) => f.label),
      choices.length
        ? el(
            doc,
            "fieldset",
            { class: "privileges-choices" },
            el(doc, "legend", { class: "sr-only" }, t("features.privileges.dialog.options")),
            ...choices,
          )
        : undefined,
      ...model.notes.map((note) => el(doc, "p", { class: "hint privileges-note" }, note)),
      el(
        doc,
        "p",
        { class: "privileges-script-label", id: "privileges-script-label" },
        t("features.privileges.dialog.runs"),
      ),
      script,
      problem,
      el(doc, "p", { class: "buttons" }, cancel, run),
    )
  );
  script.setAttribute("aria-labelledby", "privileges-script-label");
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    update();
    if (!run.disabled) done(answers());
  });
  update();
  return form;
}
