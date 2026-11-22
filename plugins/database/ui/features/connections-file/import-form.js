// The import dialog (PG-15): what the file is, and a row per entry with what importing it does:
// added, a change (the fields it changes), already here (skipped, no box) or a name taken here
// (unticked; ticked, the name it is added under). The names follow the ticks. Import answers the
// ticked rows' indexes; Cancel and Escape nothing; nothing ticked holds the button.

import { el } from "../../dom.js";
import { checkRow, pickList } from "./pick-list.js";
import { applyImport } from "./plan.js";

/** @typedef {import("./transfer.js").ImportModel} ImportModel */

const KINDS = { add: "new", change: "changes", same: "already here", taken: "name taken" };

/** What the row's line says after its name. */
function whatOf(/** @type {import("./plan.js").Row} */ row) {
  if (row.kind === "change") return `Changes ${row.changes.join(", ")}.`;
  if (row.kind === "same") return "Already here: skipped.";
  if (row.kind === "taken") return `A connection here is named ${row.was}.`;
  return "Added.";
}

/** The line under the title: what kind of file, and how many entries. */
function aboutOf(/** @type {ImportModel} */ model) {
  const n = model.rows.length;
  if (model.kind === "service")
    return `A PostgreSQL service file · ${n} service${n === 1 ? "" : "s"}, each a PostgreSQL connection; passwords are left out. Nothing is kept until you import.`;
  const at = model.exported ? `, exported ${model.exported.slice(0, 10)}` : "";
  return `A connections file, version ${model.version}${at} · ${n} connection${n === 1 ? "" : "s"}. Nothing is kept until you import.`;
}

/**
 * @param {Document} doc
 * @param {ImportModel} model
 * @param {(answer?: unknown) => void} done
 */
export function importDialog(doc, model, done) {
  /** @type {HTMLElement[]} */
  const named = [];
  const rows = model.rows.map((row, i) => {
    const as = el(doc, "span", { class: "connections-as", "data-part": "as" });
    named.push(as);
    return checkRow(
      doc,
      {
        value: String(i),
        name: row.conn.name,
        on: row.ticked,
        off: row.kind === "same",
        kind: row.kind,
      },
      el(doc, "span", { class: "connections-kind" }, KINDS[row.kind]),
      el(
        doc,
        "span",
        { class: "connections-detail" },
        whatOf(row),
        as,
        ...row.notes.map((n) => ` ${n}`),
      ),
    );
  });
  const submit = /** @type {HTMLButtonElement} */ (
    el(doc, "button", { type: "submit", class: "desk-btn desk-btn-primary" }, "Import")
  );
  const ticked = () =>
    rows.filter((r) => r.box.checked && !r.box.disabled).map((r) => Number(r.box.value));
  const list = pickList(doc, {
    label: "Connections",
    rows,
    count: (n) => `${n} of ${rows.length} to import`,
    follow: () => {
      const kept = applyImport(model.local, model.rows, ticked());
      for (const as of named) as.textContent = "";
      for (const k of kept) {
        const row = model.rows[k.index];
        const as = named[k.index];
        if (row && as && k.conn.name !== row.conn.name)
          as.textContent = ` Imported as ${k.conn.name}.`;
      }
      submit.disabled = kept.length === 0;
    },
  });
  const cancel = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet" }, "Cancel");
  cancel.addEventListener("click", () => done());
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog wide connections-file", "aria-labelledby": "connections-import-title" },
      el(doc, "h2", { id: "connections-import-title" }, `Import connections from ${model.file}`),
      el(doc, "p", { class: "hint" }, aboutOf(model)),
      list.node,
      el(doc, "p", { class: "buttons" }, cancel, submit),
    )
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const chosen = ticked();
    if (chosen.length) done({ ticked: chosen });
  });
  list.update();
  return form;
}
