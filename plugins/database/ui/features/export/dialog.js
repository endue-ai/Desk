// The export's options dialog (PG-61): the fields the format reads (export/options.js), filled with
// its last options; for an .xlsx, every result of the console as a sheet each; and a note when the
// result holds fewer rows than the server has. Export… answers the options (then the save dialog
// asks where); Cancel and Escape answer nothing.

import { el } from "../../dom.js";

/**
 * @typedef {import("../../export/options.js").ExportOptions} ExportOptions
 * @typedef {{
 *   format: string, label: string, fields: (keyof ExportOptions)[], options: ExportOptions,
 *   table: string, rows: number, partial: boolean, results: number,
 * }} OptionsModel
 */

const CHOICES = /** @type {Record<string, string[][]>} */ ({
  delimiter: [
    [",", "Comma"],
    [";", "Semicolon"],
    ["\t", "Tab"],
    ["|", "Bar"],
    [" ", "Space"],
  ],
  quote: [
    ["needed", "When needed"],
    ["always", "Always"],
    ["never", "Never"],
  ],
  lineEnding: [
    ["lf", "LF (\\n)"],
    ["crlf", "CRLF (\\r\\n)"],
  ],
  encoding: [
    ["utf-8", "UTF-8"],
    ["utf-16le", "UTF-16 LE"],
    ["utf-16be", "UTF-16 BE"],
  ],
});
const NAMES = /** @type {Record<keyof ExportOptions, string>} */ ({
  delimiter: "Delimiter",
  quote: "Quoting",
  header: "A first row of column names",
  null: "NULL as",
  lineEnding: "Line ending",
  encoding: "Encoding",
  bom: "A byte order mark",
  table: "Table",
  batch: "Rows per INSERT",
  head: "First line",
  row: "Each row",
  separator: "Between rows",
  foot: "Last line",
});

/**
 * @param {Document} doc
 * @param {OptionsModel} model
 * @param {(answer?: unknown) => void} done
 */
export function optionsDialog(doc, model, done) {
  const o = model.options;
  /** @type {Array<() => [string, unknown]>} */
  const reads = [];
  const fields = model.fields.map((key) => {
    const value = o[key];
    if (typeof value === "boolean") {
      const box = /** @type {HTMLInputElement} */ (
        el(doc, "input", { type: "checkbox", class: "desk-check", name: key })
      );
      box.checked = value;
      reads.push(() => [key, box.checked]);
      return el(doc, "label", { class: "check" }, box, ` ${NAMES[key]}`);
    }
    const items = CHOICES[key];
    /** @type {HTMLInputElement | HTMLSelectElement} */
    let control;
    if (items) {
      const select = /** @type {HTMLSelectElement} */ (
        el(doc, "select", { class: "desk-field", name: key })
      );
      const known = items.some(([v]) => v === value);
      for (const [v, text] of known ? items : [...items, [String(value), `"${value}"`]])
        select.append(el(doc, "option", { value: v ?? "" }, text ?? ""));
      select.value = String(value);
      control = select;
    } else {
      const number = key === "batch";
      control = /** @type {HTMLInputElement} */ (
        el(doc, "input", {
          class: "desk-field",
          name: key,
          type: number ? "number" : "text",
          ...(number ? { min: "1", max: "10000", step: "1" } : {}),
          ...(key === "table" && model.table ? { placeholder: model.table } : {}),
          ...(key === "row" ? { required: true, placeholder: "{{id}}: {{name}}" } : {}),
          spellcheck: "false",
        })
      );
      control.value = String(value);
    }
    const input = control;
    reads.push(() => [key, key === "batch" ? Number(input.value) : input.value]);
    return el(doc, "label", {}, el(doc, "span", {}, NAMES[key]), control);
  });
  const sheets = /** @type {HTMLInputElement} */ (
    el(doc, "input", { type: "checkbox", class: "desk-check", name: "sheets" })
  );
  const many =
    model.results > 1
      ? el(
          doc,
          "label",
          { class: "check" },
          sheets,
          ` Every result of the console (${model.results}), a sheet each`,
        )
      : undefined;
  const count = `${model.rows.toLocaleString("en-US")} row${model.rows === 1 ? "" : "s"}`;
  const notes = [
    el(doc, "p", { class: "hint" }, `${count}. You choose where the file goes next.`),
    model.format === "template"
      ? el(
          doc,
          "p",
          { class: "hint" },
          "In Each row, {{column}} or {{1}} is a value and {{#}} the row's number.",
        )
      : undefined,
    model.partial
      ? el(
          doc,
          "p",
          { class: "hint", "data-part": "partial" },
          "The server has more rows than the result holds: load more rows first to export them.",
        )
      : undefined,
  ];
  const cancel = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet" }, "Cancel");
  cancel.addEventListener("click", () => done());
  const submit = el(
    doc,
    "button",
    { type: "submit", class: "desk-btn desk-btn-primary" },
    "Export…",
  );
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog export-options", "aria-labelledby": "export-options-title" },
      el(doc, "h2", { id: "export-options-title" }, `Export as ${model.label}`),
      ...fields,
      many,
      ...notes,
      el(doc, "p", { class: "buttons" }, cancel, submit),
    )
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    done({
      options: Object.fromEntries(reads.map((read) => read())),
      sheets: sheets.checked ? "all" : "shown",
    });
  });
  return form;
}
