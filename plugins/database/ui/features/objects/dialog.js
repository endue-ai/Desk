// The dialog of an operation on an object (PG-52): where it runs (the connection, its engine and
// its environment tag), its fields and choices, what depends on the object, the notes, and the
// exact script, written again (statements.js) as the person types and chooses. A script the answers
// cannot make says why in its place and the run button waits. Run answers the fields' values and
// the choices on; Cancel and Escape answer nothing (view-dialog.js).

import { el } from "../../dom.js";
import { scriptOf } from "./statements.js";

/**
 * @typedef {import("./models.js").OperationModel} OperationModel
 * @typedef {import("./models.js").Field} Field
 * @typedef {import("./sql-postgres.js").Dependent} Dependent
 */

/** One field: a line, a list to pick from, or a box of lines. */
function fieldOf(/** @type {Document} */ doc, /** @type {Field} */ field) {
  const id = `object-field-${field.name}`;
  /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */
  let input;
  if (field.kind === "select") {
    input = /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        { id, name: field.name, class: "desk-field" },
        ...(field.options ?? []).map((o) => el(doc, "option", { value: o }, o)),
      )
    );
  } else if (field.kind === "textarea") {
    input = /** @type {HTMLTextAreaElement} */ (
      el(doc, "textarea", {
        id,
        name: field.name,
        class: "desk-field",
        rows: "3",
        spellcheck: "false",
      })
    );
  } else {
    input = /** @type {HTMLInputElement} */ (
      el(doc, "input", {
        id,
        name: field.name,
        class: "desk-field",
        spellcheck: "false",
        autocomplete: "off",
        ...(field.list?.length ? { list: `${id}-list` } : {}),
      })
    );
  }
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
    { class: "object-field", for: id },
    el(doc, "span", {}, field.label),
    input,
    list,
    field.hint ? el(doc, "span", { class: "hint" }, field.hint) : undefined,
  );
  return { label, input };
}

/** What depends on the object: what blocks a plain DROP first, then what goes with it. */
function dependentsOf(/** @type {Document} */ doc, /** @type {OperationModel} */ model) {
  const found = model.dependents;
  if (!found) return undefined;
  const items = (/** @type {Dependent[]} */ list) =>
    el(
      doc,
      "ul",
      { class: "object-dependents" },
      ...list.map((d) =>
        el(doc, "li", {}, el(doc, "span", { class: "hint" }, d.kind), ` ${d.name}`),
      ),
    );
  const { blocking, along, more } = found;
  const heading = (/** @type {number} */ n) =>
    n === 1
      ? "1 object depends on it: CASCADE drops it too"
      : `${n} objects depend on it: CASCADE drops them too`;
  return el(
    doc,
    "section",
    {
      class: blocking.length ? "object-depends blocking" : "object-depends",
      "aria-label": "What depends on it",
    },
    blocking.length
      ? el(doc, "h3", {}, heading(blocking.length))
      : el(doc, "p", { class: "hint" }, "Nothing else depends on it."),
    blocking.length ? items(blocking) : undefined,
    along.length ? el(doc, "h3", {}, "Goes with it") : undefined,
    along.length ? items(along) : undefined,
    more ? el(doc, "p", { class: "hint" }, `and ${more} more`) : undefined,
  );
}

/**
 * @param {Document} doc
 * @param {OperationModel} model
 * @param {(answer?: unknown) => void} done
 */
export function operationDialog(doc, model, done) {
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
      { class: "check object-choice" },
      box,
      el(doc, "span", { class: "object-choice-name" }, choice.label),
      el(doc, "span", { class: "hint" }, choice.hint),
    );
  });
  const script = el(doc, "pre", {
    class: "object-script",
    id: "object-script",
    tabindex: "0",
    "aria-live": "polite",
  });
  const problem = el(doc, "p", { class: "object-problem", role: "alert" });
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
  const cancel = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet" }, "Cancel");
  cancel.addEventListener("click", () => done());

  const answers = () => ({
    values: Object.fromEntries(model.fields.map((f, i) => [f.name, fields[i]?.input.value ?? ""])),
    choices: [...boxes].filter(([, box]) => box.checked && !box.disabled).map(([name]) => name),
  });
  /** Write the script from the answers, or say why there is none. */
  const update = () => {
    try {
      script.textContent = scriptOf(model.engine, model.op, model.target, model.facts, answers());
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
      { class: "dialog object-operation", "aria-labelledby": "object-title" },
      el(doc, "h2", { id: "object-title" }, model.title),
      el(
        doc,
        "p",
        { class: "hint object-where" },
        model.where,
        model.tag ? el(doc, "span", { class: `tag tag-${model.tag}` }, model.tag) : undefined,
      ),
      ...fields.map((f) => f.label),
      choices.length
        ? el(
            doc,
            "fieldset",
            { class: "object-choices" },
            el(doc, "legend", { class: "sr-only" }, "Options"),
            ...choices,
          )
        : undefined,
      dependentsOf(doc, model),
      ...model.notes.map((note) => el(doc, "p", { class: "hint object-note" }, note)),
      el(doc, "p", { class: "object-script-label", id: "object-script-label" }, "Runs"),
      script,
      problem,
      el(doc, "p", { class: "buttons" }, cancel, run),
    )
  );
  script.setAttribute("aria-labelledby", "object-script-label");
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
