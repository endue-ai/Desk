// The search panel (features/README.md): a header, the form (the value, how to match, ignoring
// case, the schemas, the tables, the kinds of column, the limits), the sentence of what a search
// reads, Search and Cancel, the progress while it runs, and results.js's results. The form is the
// panel's own until Search: a change of what is read (schemas, tables, kinds, size) sends the
// fields for a new estimate; Search sends them all. A new state is drawn in place and a field that
// has the focus keeps what was typed. Enter searches, Escape cancels. Layout: search.css.

import { el } from "../../dom.js";
import { formatCount } from "../../format.js";
import { FAMILIES, MATCHES } from "./columns.js";
import { LIMITS } from "./model.js";
import { createResults } from "./results.js";

/**
 * @typedef {import("./controller.js").SearchState} SearchState
 * @typedef {import("./model.js").Options} Options
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const HINTS = "Enter search · Escape cancel · a column or a row opens the table filtered";

/**
 * @param {Document} doc
 * @param {SearchState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function searchPanel(doc, first, act, buffer) {
  let state = first;
  let synced = "";
  const id = buffer.id;
  const field = (/** @type {string} */ name, /** @type {Record<string, string>} */ attrs = {}) =>
    /** @type {HTMLInputElement} */ (
      el(doc, "input", { class: "desk-field", name, "data-field": name, ...attrs })
    );
  const check = (
    /** @type {string} */ name,
    /** @type {string} */ value,
    /** @type {string} */ text,
  ) => {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name, value, "data-field": name })
    );
    return { input, label: el(doc, "label", { class: "search-check" }, input, ` ${text}`) };
  };
  const labelled = (/** @type {string} */ text, /** @type {HTMLElement} */ control, cls = "") =>
    el(doc, "label", { class: `search-field ${cls}`.trim() }, el(doc, "span", {}, text), control);
  const number = (/** @type {string} */ name, /** @type {readonly number[]} */ limits) =>
    field(name, {
      type: "number",
      min: String(limits[0]),
      max: String(limits[1]),
      step: "1",
      inputmode: "numeric",
    });

  const value = field("value", {
    type: "search",
    placeholder: "4242",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Value to find",
  });
  const match = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", name: "match", "data-field": "match" },
      ...MATCHES.map(([key, text]) => el(doc, "option", { value: key }, text)),
    )
  );
  const ignore = check("ignoreCase", "yes", "Ignore case");
  const schemaBox = el(doc, "div", { class: "search-checks" });
  /** @type {{ input: HTMLInputElement, label: HTMLElement }[]} */
  let schemaChecks = [];
  const tables = field("tables", {
    type: "text",
    placeholder: "orders, sales.audit_*",
    autocomplete: "off",
    spellcheck: "false",
  });
  const families = FAMILIES.map(([key, text]) => check("families", key, text));
  const rowLimit = number("rowLimit", LIMITS.rowLimit);
  const timeout = number("timeoutSeconds", LIMITS.timeoutSeconds);
  const size = number("sizeLimit", LIMITS.sizeLimit);
  const big = check("big", "yes", "Search them too");
  const estimate = el(doc, "p", { class: "search-estimate", "data-part": "estimate" });
  const error = el(doc, "div", { "data-part": "error" });
  const search = /** @type {HTMLButtonElement} */ (
    el(
      doc,
      "button",
      { type: "submit", class: "desk-btn desk-btn-primary", "data-ctl": "search" },
      "Search",
    )
  );
  const cancel = /** @type {HTMLButtonElement} */ (
    el(doc, "button", { type: "button", class: "desk-btn", "data-ctl": "cancel" }, "Cancel")
  );
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "search-form", role: "search", "aria-label": "Search for a value" },
      el(
        doc,
        "div",
        { class: "search-row" },
        labelled("Value", value, "search-value"),
        labelled("Match", match),
        ignore.label,
      ),
      el(doc, "fieldset", { class: "search-set" }, el(doc, "legend", {}, "Schemas"), schemaBox),
      labelled("Tables (every one when empty)", tables, "search-names"),
      el(
        doc,
        "fieldset",
        { class: "search-set" },
        el(doc, "legend", {}, "Look in"),
        el(doc, "div", { class: "search-checks" }, ...families.map((f) => f.label)),
      ),
      el(
        doc,
        "div",
        { class: "search-row" },
        labelled("Rows per table", rowLimit),
        labelled("Seconds per table", timeout),
        labelled("Skip tables over (rows)", size),
        big.label,
      ),
      estimate,
      el(doc, "div", { class: "search-actions" }, search, cancel),
    )
  );
  const progress = el(doc, "div", {
    class: "search-progress",
    role: "status",
    "data-part": "progress",
  });
  const results = createResults(doc, (t, c, h) => act("searchOpen", id, t, c, h));
  const root = el(
    doc,
    "div",
    { class: "search" },
    el(
      doc,
      "div",
      { class: "desk-header search-header" },
      el(
        doc,
        "div",
        { class: "desk-header-text" },
        el(doc, "h2", { class: "desk-header-title" }, "Search for a value"),
        el(doc, "p", { class: "desk-header-desc", "data-part": "about" }),
      ),
    ),
    form,
    error,
    progress,
    results.el,
  );

  /** The form's fields as the controller reads them. */
  const fields = () => ({
    value: value.value,
    match: match.value,
    ignoreCase: ignore.input.checked,
    schemas: schemaChecks.filter((c) => c.input.checked).map((c) => c.input.value),
    tables: tables.value,
    types: families.filter((f) => f.input.checked).map((f) => f.input.value),
    rowLimit: Number(rowLimit.value),
    timeoutSeconds: Number(timeout.value),
    sizeLimit: Number(size.value),
    big: big.input.checked,
  });
  const running = () => state.run?.phase === "running";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!running()) act("searchStart", id, fields());
  });
  cancel.addEventListener("click", () => act("searchCancel", id));
  // What is read changed: say again what a search would read.
  form.addEventListener("change", (event) => {
    const name = /** @type {HTMLElement} */ (event.target).dataset.field ?? "";
    if (["schemas", "tables", "families", "sizeLimit", "big", "timeoutSeconds"].includes(name))
      act("searchChange", id, fields());
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && running()) {
      event.preventDefault();
      act("searchCancel", id);
    }
  });
  root.addEventListener("focusin", () => {
    const line = doc.getElementById("hints");
    if (line) line.textContent = HINTS;
  });

  /** Put the state's options in the fields, but the one being typed in. */
  const sync = (/** @type {SearchState} */ s) => {
    const o = s.options;
    const names = s.schemas.join("\n");
    if (schemaBox.dataset.names !== names) {
      schemaChecks = s.schemas.map((name) => check("schemas", name, name));
      schemaBox.replaceChildren(...schemaChecks.map((c) => c.label));
      schemaBox.dataset.names = names;
      synced = "";
    }
    const key = JSON.stringify(o);
    if (key === synced) return;
    synced = key;
    const focused = doc.activeElement;
    const put = (
      /** @type {HTMLInputElement | HTMLSelectElement} */ input,
      /** @type {string} */ v,
    ) => {
      if (input !== focused) input.value = v;
    };
    put(value, o.value);
    put(match, o.match);
    ignore.input.checked = o.ignoreCase;
    for (const c of schemaChecks) c.input.checked = o.schemas.includes(c.input.value);
    put(tables, o.tables);
    for (const f of families)
      f.input.checked = o.families.includes(/** @type {never} */ (f.input.value));
    put(rowLimit, String(o.rowLimit));
    put(timeout, String(o.timeoutSeconds));
    put(size, String(o.sizeLimit));
    big.input.checked = o.big;
  };

  const draw = () => {
    const s = state;
    sync(s);
    const where = [
      s.conn.name,
      s.conn.tag !== "none" ? s.conn.tag : "",
      s.conn.readOnly ? "read-only" : "",
    ];
    /** @type {HTMLElement} */ (root.querySelector('[data-part="about"]')).textContent =
      `In the tables of ${where.filter(Boolean).join(" · ")}, one table at a time in a read-only transaction.`;
    estimate.textContent = s.estimate;
    search.disabled = running();
    cancel.disabled = !running();
    error.replaceChildren(
      ...(s.error
        ? [el(doc, "div", { class: "desk-error", role: "alert" }, el(doc, "p", {}, s.error))]
        : []),
    );
    const run = s.run;
    if (run?.phase === "running") {
      const bar = el(doc, "progress", {
        class: "desk-progress",
        max: String(Math.max(1, run.total)),
        value: String(run.done),
        "aria-label": "Tables searched",
      });
      const found = run.tables.reduce((n, t) => n + t.rows, 0);
      const line = [
        run.current ? `Searching ${run.current}` : "Starting",
        `${formatCount(run.done)} of ${formatCount(run.total)} tables`,
        `${formatCount(found)} ${found === 1 ? "row" : "rows"} found so far`,
      ].join(" · ");
      progress.replaceChildren(
        el(
          doc,
          "p",
          { class: "search-status" },
          el(doc, "span", { class: "desk-spinner", "aria-hidden": "true" }),
          ` ${line}`,
        ),
        bar,
      );
    } else progress.replaceChildren();
    results.draw(run);
  };

  draw();
  return {
    el: root,
    update(/** @type {SearchState} */ next) {
      state = next;
      draw();
    },
  };
}
