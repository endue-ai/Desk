// The import wizard's DOM (importer.js holds what it shows): where the file goes (a connection, a
// schema, a table), how it reads (a header line, empty fields as NULL), one row per column of the
// file with an example value and the table column it goes to, a preview of the first rows as they
// will be inserted, the SQL, and Import, which runs it all in one transaction. Escape cancels. On a
// PostgreSQL connection the COPY part (import-copy/view.js) adds its options, a new table's columns
// as a name and a type each, the server's check and the progress (PG-60).

import { sizeText } from "./console-files.js";
import { el } from "./dom.js";
import { createCopyView } from "./import-copy/view.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./importer.js").ImportModel} ImportModel
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** A value as the grid shows it: NULL apart from an empty string. */
const shown = (/** @type {string | null | undefined} */ value) =>
  value === null || value === undefined ? "NULL" : value === "" ? "''" : value;

/** What a COPY import will do, in a sentence. @param {NonNullable<ImportModel["copy"]>} c */
const copySummary = (c) => {
  const how = c.batch > 0 ? t("import.copyBatch", { count: c.batch }) : t("import.copyOne");
  const errors = t(c.onError === "skip" ? "import.copySkip" : "import.copyStop");
  return t("import.copySummary", { how, errors });
};

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 */
export function createImportView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const form = /** @type {HTMLFormElement} */ (byId("import"));
  const select = (/** @type {string} */ id) => /** @type {HTMLSelectElement} */ (byId(id));
  const check = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));
  const [connection, schema, table] = ["i-connection", "i-schema", "i-table"].map(select);
  const [header, empty] = ["i-header", "i-empty"].map(check);
  const map = byId("import-map");
  const preview = byId("import-preview");
  const run = /** @type {HTMLButtonElement} */ (byId("import-run"));
  const copy = createCopyView(doc, act);
  /** @type {ImportModel | null} */
  let model = null;

  /** Fill a select with options, keeping the one chosen. */
  const options = (
    /** @type {HTMLSelectElement} */ node,
    /** @type {Array<[string, string]>} */ pairs,
    /** @type {string} */ chosen,
  ) => {
    node.replaceChildren(
      ...pairs.map(([value, label]) => {
        const option = /** @type {HTMLOptionElement} */ (el(doc, "option", { value }, label));
        option.selected = value === chosen;
        return option;
      }),
    );
    node.value = chosen;
  };

  const drawMap = (/** @type {ImportModel} */ m) => {
    const head = el(
      doc,
      "tr",
      {},
      el(doc, "th", { scope: "col" }, t("import.inFile")),
      el(doc, "th", { scope: "col" }, t("import.firstRow")),
      el(
        doc,
        "th",
        { scope: "col" },
        t(m.copy?.target === "new" ? "import.columnAndType" : "import.goesTo"),
      ),
    );
    const choices = /** @type {Array<[string, string]>} */ ([
      ["", t("import.leaveOut")],
      ...m.columns.map((c) => [c.name, c.type ? `${c.name} (${c.type})` : c.name]),
    ]);
    const rows = m.fileColumns.map((name, index) => {
      if (m.copy?.target === "new")
        return el(
          doc,
          "tr",
          {},
          el(doc, "th", { scope: "row" }, name),
          el(doc, "td", { class: "example" }, shown(m.examples[index])),
          el(doc, "td", { class: "new-column" }, ...copy.newColumn(m, index)),
        );
      const pick = /** @type {HTMLSelectElement} */ (
        el(doc, "select", {
          class: "desk-field",
          "data-index": String(index),
          "aria-label": t("import.goesToOf", { name }),
        })
      );
      options(pick, choices, m.mapping[index] ?? "");
      pick.disabled = m.running || m.columns.length === 0;
      return el(
        doc,
        "tr",
        {},
        el(doc, "th", { scope: "row" }, name),
        el(doc, "td", { class: "example" }, shown(m.examples[index])),
        el(doc, "td", {}, pick),
      );
    });
    map.replaceChildren(el(doc, "thead", {}, head), el(doc, "tbody", {}, ...rows));
  };

  const drawPreview = (/** @type {ImportModel} */ m) => {
    const head = el(
      doc,
      "tr",
      {},
      ...m.preview.columns.map((c) => el(doc, "th", { scope: "col" }, c)),
    );
    const rows = m.preview.rows.map((row) =>
      el(
        doc,
        "tr",
        {},
        ...row.map((v) => el(doc, "td", { class: v === null ? "null" : undefined }, shown(v))),
      ),
    );
    preview.replaceChildren(el(doc, "thead", {}, head), el(doc, "tbody", {}, ...rows));
  };

  /** Draw the wizard, or close it (null). */
  const render = (/** @type {ImportModel | null} */ next) => {
    const opening = next !== null && model === null;
    // Closing with the focus inside: it goes back to the explorer, not to the page's body.
    const closing = next === null && form.contains(doc.activeElement);
    model = next;
    form.hidden = next === null;
    if (!next) {
      if (closing) byId("tree").focus();
      return;
    }
    byId("import-title").textContent = t("import.title", { file: next.file });
    const columns = t("import.columns", { count: next.fileColumns.length });
    const format = next.format.toUpperCase();
    byId("import-file").textContent = next.copy
      ? t("import.fileCopy", { format, size: sizeText(next.copy.size), columns, count: next.rows })
      : t("import.fileRows", { rows: t("import.rows", { count: next.rows }), format, columns });
    options(
      connection,
      next.connections.map((c) => [c.id, c.name]),
      next.connection,
    );
    options(
      schema,
      (next.schemas.length ? next.schemas : [next.schema]).map((s) => [s, s]),
      next.schema,
    );
    options(
      table,
      [
        ["", t("import.pickTable")],
        ...next.tables.map((name) => /** @type {[string, string]} */ ([name, name])),
      ],
      next.table,
    );
    header.checked = next.header;
    header.disabled = next.format === "json" || next.running;
    empty.checked = next.emptyNull;
    empty.disabled = next.format !== "csv" || next.running;
    // The COPY's NULL text says what an empty field is.
    empty.closest("label")?.toggleAttribute("hidden", Boolean(next.copy));
    for (const node of [connection, schema, table]) node.disabled = next.running;
    table.disabled = next.running || next.copy?.target === "new";
    copy.render(next);
    drawMap(next);
    drawPreview(next);
    byId("import-summary").textContent = next.problem
      ? ""
      : next.copy
        ? copySummary(next.copy)
        : t("import.summaryInsert", {
            rows: t("import.rows", { count: next.rows }),
            statements: t("import.statements", { count: next.statements }),
          });
    byId("import-sql").textContent = next.sql;
    byId("import-problem").textContent = next.problem;
    run.disabled = next.running || next.problem !== "";
    run.textContent = t(next.running ? "import.running" : "import.run");
    const first = /** @type {HTMLElement | null} */ (map.querySelector("select"));
    if (opening) (next.table && first ? first : table).focus();
  };

  connection.addEventListener("change", () =>
    act("importChange", { connection: connection.value }),
  );
  schema.addEventListener("change", () => act("importChange", { schema: schema.value }));
  table.addEventListener("change", () => act("importChange", { table: table.value }));
  header.addEventListener("change", () => act("importChange", { header: header.checked }));
  empty.addEventListener("change", () => act("importChange", { empty: empty.checked }));
  map.addEventListener("change", (event) => {
    const pick = /** @type {HTMLSelectElement | HTMLInputElement} */ (event.target);
    const index = Number(pick.dataset.index);
    if (Number.isNaN(index)) return;
    if (pick.dataset.part)
      act("importChange", { column: [index, { [pick.dataset.part]: pick.value }] });
    else act("importChange", { map: [index, pick.value || null] });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    act("importRun");
  });
  byId("import-cancel").addEventListener("click", () => act("importCancel"));
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || model?.running) return;
    event.preventDefault();
    act("importCancel");
  });

  return { render };
}
