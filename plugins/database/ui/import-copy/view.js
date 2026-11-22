// The import wizard's COPY part on a PostgreSQL connection (PG-60), its DOM (wizard.js holds what it
// shows): into the table or a new one with its name, how the file reads (encoding, delimiter, quote,
// escape, the NULL text, rows to skip, the date order, trimming), what an error does and the rows per
// transaction, the new table's columns as a name and a type per file column, the server's check of
// the first rows, and the progress in rows and bytes with its Cancel. Its controls come back as
// `importChange`, `importCheck` and `importCancel`.

import { sizeText } from "../console-files.js";
import { el } from "../dom.js";
import { formatCount } from "../format.js";
import { TYPES } from "./infer.js";
import { ENCODINGS } from "./wizard.js";

/**
 * @typedef {import("../importer.js").ImportModel} ImportModel
 * @typedef {NonNullable<ImportModel["copy"]>} CopyModel
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const shown = (/** @type {string | null | undefined} */ value) =>
  value === null || value === undefined ? "NULL" : value === "" ? "''" : value;
/** A delimiter as the field shows it: a tab as `\t`. */
const charIn = (/** @type {string} */ c) => (c === "\t" ? "\\t" : c);
const charOut = (/** @type {string} */ c) => (c === "\\t" ? "\t" : c);

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createCopyView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));
  const box = byId("import-copy");
  const checks = byId("import-checks");
  const check = /** @type {HTMLButtonElement} */ (byId("import-check"));
  const serverBox = byId("import-server-box");
  const server = byId("import-server");
  const serverError = byId("import-server-error");
  const progress = byId("import-progress");
  const [existing, made, newTable] = ["i-target-existing", "i-target-new", "i-new-table"].map(
    input,
  );
  const fields = {
    encoding: input("i-encoding"),
    delimiter: input("i-delimiter"),
    quote: input("i-quote"),
    escape: input("i-escape"),
    nullText: input("i-null"),
    skip: input("i-skip"),
  };
  const dates = /** @type {HTMLSelectElement} */ (byId("i-dates"));
  const trim = input("i-trim");
  const onError = /** @type {HTMLSelectElement} */ (byId("i-on-error"));
  const batch = input("i-batch");
  byId("i-encodings").replaceChildren(...ENCODINGS.map((e) => el(doc, "option", { value: e })));
  byId("i-types").replaceChildren(...TYPES.map((t) => el(doc, "option", { value: t })));

  const option = (/** @type {Record<string, unknown>} */ options) =>
    act("importChange", { options });
  for (const [key, node] of Object.entries(fields))
    node.addEventListener("change", () =>
      option({ [key]: key === "delimiter" ? charOut(node.value) : node.value }),
    );
  dates.addEventListener("change", () => option({ dateOrder: dates.value }));
  trim.addEventListener("change", () => option({ trim: trim.checked }));
  for (const radio of [existing, made])
    radio.addEventListener("change", () => act("importChange", { target: radio.value }));
  newTable.addEventListener("change", () => act("importChange", { newTable: newTable.value }));
  onError.addEventListener("change", () => act("importChange", { onError: onError.value }));
  batch.addEventListener("change", () => act("importChange", { batch: Number(batch.value) || 0 }));
  check.addEventListener("click", () => act("importCheck"));
  progress.addEventListener("desk-cancel", () => act("importCancel"));

  /** A field set from the model, unless the person is typing in it. */
  const set = (/** @type {HTMLInputElement} */ node, /** @type {string} */ value) => {
    if (doc.activeElement !== node) node.value = value;
  };

  const drawServer = (/** @type {CopyModel} */ c) => {
    const answer = c.server;
    serverError.textContent = answer && "error" in answer ? `The server: ${answer.error}` : "";
    serverBox.hidden = !answer || "error" in answer;
    if (!answer || "error" in answer) return server.replaceChildren();
    const head = el(
      doc,
      "tr",
      {},
      ...answer.columns.map((n) => el(doc, "th", { scope: "col" }, n)),
    );
    const rows = answer.rows.map((row) =>
      el(
        doc,
        "tr",
        {},
        ...row.map((v) => el(doc, "td", { class: v === null ? "null" : undefined }, shown(v))),
      ),
    );
    server.replaceChildren(el(doc, "thead", {}, head), el(doc, "tbody", {}, ...rows));
  };

  return {
    /** Draw the COPY part, or hide it (the INSERT import of another engine). */
    render(/** @type {ImportModel} */ m) {
      const c = m.copy;
      box.hidden = !c;
      checks.hidden = !c;
      if (!c) {
        serverBox.hidden = true;
        serverError.textContent = "";
        progress.hidden = true;
        return;
      }
      existing.checked = c.target === "existing";
      made.checked = c.target === "new";
      set(newTable, c.newTable);
      newTable.disabled = c.target !== "new" || m.running;
      set(fields.encoding, c.options.encoding);
      set(fields.delimiter, charIn(c.options.delimiter));
      set(fields.quote, c.options.quote);
      set(fields.escape, c.options.escape);
      set(fields.nullText, c.options.nullText);
      set(fields.skip, String(c.options.skip));
      dates.value = c.options.dateOrder;
      trim.checked = c.options.trim;
      const csv = c.format === "csv";
      const delimited = csv || c.format === "tsv";
      fields.delimiter.disabled = !delimited || m.running;
      fields.quote.disabled = !csv || m.running;
      fields.escape.disabled = !csv || m.running;
      fields.nullText.disabled = !delimited || m.running;
      for (const node of [
        fields.encoding,
        fields.skip,
        dates,
        trim,
        existing,
        made,
        onError,
        batch,
      ])
        node.disabled = m.running;
      onError.value = c.onError;
      set(batch, c.batch > 0 ? String(c.batch) : "");
      check.disabled = m.running || c.checking || m.problem !== "";
      check.textContent = c.checking ? "Checking…" : "Check on the server";
      drawServer(c);
      progress.hidden = !c.progress;
      if (c.progress) {
        const { rows, bytes, total } = c.progress;
        progress.setAttribute("label", `Importing ${m.file}`);
        progress.setAttribute(
          "detail",
          `${formatCount(rows)} rows, ${sizeText(bytes)}${total ? ` of ${sizeText(total)}` : ""} read`,
        );
        if (total) {
          progress.setAttribute("max", String(total));
          progress.setAttribute("value", String(bytes));
        } else progress.removeAttribute("value");
      }
    },

    /** The new table's column for one file column: its name and type, editable. */
    newColumn(/** @type {ImportModel} */ m, /** @type {number} */ index) {
      const column = m.copy?.newColumns[index] ?? { name: "", type: "text" };
      const name = /** @type {HTMLInputElement} */ (
        el(doc, "input", {
          class: "desk-field",
          "data-index": String(index),
          "data-part": "name",
          "aria-label": `${m.fileColumns[index]}: column name (empty leaves it out)`,
          autocomplete: "off",
          spellcheck: "false",
        })
      );
      const type = /** @type {HTMLInputElement} */ (
        el(doc, "input", {
          class: "desk-field",
          list: "i-types",
          "data-index": String(index),
          "data-part": "type",
          "aria-label": `${m.fileColumns[index]}: type`,
          autocomplete: "off",
          spellcheck: "false",
        })
      );
      name.value = column.name;
      type.value = column.type;
      name.disabled = type.disabled = m.running;
      return [name, type];
    },
  };
}
