// The copy's form (PG-63): the connection to copy into (a read-only one cannot be chosen), its
// database (the connection's when empty) and schema, the target's name for one table or a query's
// result, and what to copy: structure, data or both and the foreign keys for tables, a new table or
// an append for a query. Check reads both sides and opens the copy's panel; nothing runs yet.
// Cancel and Escape answer nothing (view-dialog.js). Layout: transfer.css.

import { el } from "../dom.js";
import { t } from "../strings/index.js";

/**
 * @typedef {{ id: string, name: string, database: string, readOnly: boolean }} Choice
 * @typedef {{
 *   kind: "tables" | "query", source: string, what: string, connections: Choice[], target: string,
 *   database: string, schema: string, name: string, content?: string, foreignKeys?: boolean,
 *   append?: boolean,
 * }} FormModel
 */

const CONTENTS = [
  ["both", "Structure and data"],
  ["structure", "Structure only"],
  ["data", "Data only, into tables already there"],
];

/**
 * @param {Document} doc
 * @param {FormModel} model
 * @param {(answer?: unknown) => void} done
 */
export function transferDialog(doc, model, done) {
  const input = (
    /** @type {string} */ name,
    /** @type {string} */ value,
    /** @type {string} */ hint,
  ) => {
    const field = /** @type {HTMLInputElement} */ (
      el(doc, "input", { class: "desk-field", name, placeholder: hint, spellcheck: "false" })
    );
    field.value = value;
    return field;
  };
  const labelled = (
    /** @type {string} */ text,
    /** @type {HTMLElement} */ control,
    /** @type {string} */ part,
  ) => el(doc, "label", { "data-part": part }, el(doc, "span", {}, text), control);
  const check = (
    /** @type {string} */ name,
    /** @type {string} */ text,
    /** @type {boolean} */ on,
  ) => {
    const box = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name })
    );
    box.checked = on;
    return { box, label: el(doc, "label", { class: "check" }, box, ` ${text}`) };
  };

  const target = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", name: "target" },
      ...model.connections.map((c) => {
        const option = /** @type {HTMLOptionElement} */ (
          el(
            doc,
            "option",
            { value: c.id },
            c.readOnly ? t("transfer.form.readOnly", { name: String(c.name) }) : c.name,
          )
        );
        option.disabled = c.readOnly;
        option.selected = c.id === model.target;
        return option;
      }),
    )
  );
  const database = input("database", model.database, "");
  const schema = input("schema", model.schema, "public");
  const name = input("name", model.name, model.kind === "query" ? "query_result" : "");
  const content = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", name: "content" },
      ...CONTENTS.map(([value, text]) => {
        const option = /** @type {HTMLOptionElement} */ (
          el(doc, "option", { value: value ?? "" }, text ?? "")
        );
        option.selected = value === (model.content ?? "both");
        return option;
      }),
    )
  );
  const keys = check(
    "foreignKeys",
    "Foreign keys, added once every table's rows are in",
    model.foreignKeys !== false,
  );
  const append = check(
    "append",
    "Append to a table already there, by a column mapping",
    model.append === true,
  );
  const problem = el(doc, "p", { class: "transfer-problem", role: "alert" });
  const submit = /** @type {HTMLButtonElement} */ (
    el(
      doc,
      "button",
      { type: "submit", class: "desk-btn desk-btn-primary" },
      t("transfer.form.checkTheCopy"),
    )
  );
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    t("transfer.form.cancel"),
  );
  cancel.addEventListener("click", () => done());

  const tables = model.kind === "tables";
  const follow = () => {
    const chosen = model.connections.find((c) => c.id === target.value);
    database.placeholder = chosen?.database ?? "";
    keys.label.hidden = !tables || content.value === "data";
    const missing = !chosen
      ? "Choose a connection to copy into."
      : name.hidden || name.value.trim() || tables
        ? ""
        : "Name the table the result goes into.";
    problem.textContent = missing;
    submit.disabled = missing !== "";
  };
  name.hidden = tables && model.name === "";
  const answer = () => ({
    target: target.value,
    database: database.value.trim(),
    schema: schema.value.trim(),
    name: name.hidden ? "" : name.value.trim(),
    ...(tables
      ? { content: content.value, foreignKeys: keys.box.checked }
      : { append: append.box.checked }),
  });

  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog transfer-form", "aria-labelledby": "transfer-title" },
      el(
        doc,
        "h2",
        { id: "transfer-title" },
        tables
          ? t("transfer.form.copy", { what: String(model.what) })
          : t("transfer.form.copyTheQuerySResult"),
      ),
      el(
        doc,
        "p",
        { class: "hint" },
        tables
          ? t("transfer.form.from", { source: String(model.source) })
          : t("transfer.form.from2", { source: String(model.source), what: String(model.what) }),
      ),
      labelled("Into", target, "target"),
      labelled("Database", database, "database"),
      labelled("Schema", schema, "schema"),
      ...(name.hidden ? [] : [labelled(tables ? "Name" : "Table", name, "name")]),
      ...(tables ? [labelled("Copy", content, "content"), keys.label] : [append.label]),
      el(doc, "p", { class: "hint" }, t("transfer.form.bothSidesAreReadAndCompared")),
      problem,
      el(doc, "p", { class: "buttons" }, cancel, submit),
    )
  );
  form.addEventListener("input", follow);
  form.addEventListener("change", follow);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    follow();
    if (!submit.disabled) done(answer());
  });
  follow();
  return form;
}
