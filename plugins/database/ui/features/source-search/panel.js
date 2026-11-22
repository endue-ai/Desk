// The source search panel (features/README.md): a header, the form (what to find, a regular
// expression or not, ignoring case, comments, the scope and its schema, the kinds of object),
// Search and Cancel, the progress while it runs, and results.js's results. The form is the panel's
// own until Search; a change is kept (sourceChange) so it comes back after a restart. A new
// state is drawn in place and a field that has the focus keeps what was typed. Enter searches,
// Escape cancels. Layout: source-search.css.

import { el } from "../../dom.js";
import { formatCount } from "../../format.js";
import { KINDS } from "./items.js";
import { SCOPES } from "./model.js";
import { createResults } from "./results.js";

/**
 * @typedef {import("./controller.js").SourceState} SourceState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const HINTS = "Enter search · Escape cancel · a line opens the source there";

/**
 * @param {Document} doc
 * @param {SourceState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function sourcePanel(doc, first, act, buffer) {
  let state = first;
  let synced = "";
  const id = buffer.id;
  const check = (
    /** @type {string} */ name,
    /** @type {string} */ value,
    /** @type {string} */ text,
  ) => {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name, value, "data-field": name })
    );
    return { input, label: el(doc, "label", { class: "src-check" }, input, ` ${text}`) };
  };
  const labelled = (/** @type {string} */ text, /** @type {HTMLElement} */ control, cls = "") =>
    el(doc, "label", { class: `src-field ${cls}`.trim() }, el(doc, "span", {}, text), control);
  const select = (
    /** @type {string} */ name,
    /** @type {readonly (readonly [string, string])[]} */ options,
  ) =>
    /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        { class: "desk-field", name, "data-field": name },
        ...options.map(([key, text]) => el(doc, "option", { value: key }, text)),
      )
    );

  const text = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      class: "desk-field",
      type: "search",
      name: "text",
      "data-field": "text",
      placeholder: "customer_id",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Text to find",
    })
  );
  const regex = check("regex", "yes", "Regular expression");
  const ignore = check("ignoreCase", "yes", "Ignore case");
  const comments = check("comments", "yes", "Comments too");
  const scope = select("scope", SCOPES);
  const schema = select("schema", []);
  const schemaField = labelled("Schema", schema);
  const kinds = KINDS.map(([key, label]) => check("kinds", key, label));
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
      { class: "src-form", role: "search", "aria-label": "Search the source" },
      el(
        doc,
        "div",
        { class: "src-row" },
        labelled("Find", text, "src-text"),
        regex.label,
        ignore.label,
        comments.label,
      ),
      el(doc, "div", { class: "src-row" }, labelled("In", scope), schemaField),
      el(
        doc,
        "fieldset",
        { class: "src-set" },
        el(doc, "legend", {}, "Look in"),
        el(doc, "div", { class: "src-row" }, ...kinds.map((k) => k.label)),
      ),
      el(doc, "div", { class: "src-row" }, search, cancel),
    )
  );
  const progress = el(doc, "div", {
    class: "src-progress",
    role: "status",
    "data-part": "progress",
  });
  const results = createResults(doc, (o, l) => act("sourceOpen", id, o, l));
  const root = el(
    doc,
    "div",
    { class: "src" },
    el(
      doc,
      "div",
      { class: "desk-header" },
      el(
        doc,
        "div",
        { class: "desk-header-text" },
        el(doc, "h2", { class: "desk-header-title" }, "Search the source"),
        el(doc, "p", { class: "desk-header-desc", "data-part": "about" }),
      ),
    ),
    form,
    error,
    progress,
    results.el,
  );

  const fields = () => ({
    text: text.value,
    regex: regex.input.checked,
    ignoreCase: ignore.input.checked,
    comments: comments.input.checked,
    scope: scope.value,
    schema: schema.value,
    kinds: kinds.filter((k) => k.input.checked).map((k) => k.input.value),
  });
  const running = () => state.run?.phase === "running";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!running()) act("sourceStart", id, fields());
  });
  cancel.addEventListener("click", () => act("sourceCancel", id));
  form.addEventListener("change", () => act("sourceChange", id, fields()));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && running()) {
      event.preventDefault();
      act("sourceCancel", id);
    }
  });
  root.addEventListener("focusin", () => {
    const line = doc.getElementById("hints");
    if (line) line.textContent = HINTS;
  });

  /** Put the state's options in the fields, but the one being typed in. */
  const sync = (/** @type {SourceState} */ s) => {
    const names = s.schemas.join("\n");
    if (schema.dataset.names !== names) {
      schema.replaceChildren(...s.schemas.map((n) => el(doc, "option", { value: n }, n)));
      schema.dataset.names = names;
      synced = "";
    }
    const o = s.options;
    const key = JSON.stringify(o);
    if (key === synced) return;
    synced = key;
    if (text !== doc.activeElement) text.value = o.text;
    regex.input.checked = o.regex;
    ignore.input.checked = o.ignoreCase;
    comments.input.checked = o.comments;
    scope.value = o.scope;
    schema.value = o.schema;
    for (const k of kinds) k.input.checked = o.kinds.includes(k.input.value);
  };

  const draw = () => {
    const s = state;
    sync(s);
    schemaField.hidden = s.options.scope !== "schema";
    const about = [
      s.conn.name,
      s.conn.tag !== "none" ? s.conn.tag : "",
      s.conn.readOnly ? "read-only" : "",
    ];
    /** @type {HTMLElement} */ (root.querySelector('[data-part="about"]')).textContent =
      `In the definitions the schema cache of ${about.filter(Boolean).join(" · ")} holds, and the bodies of its routines and views.`;
    search.disabled = running();
    cancel.disabled = !running();
    error.replaceChildren(
      ...(s.error
        ? [el(doc, "div", { class: "desk-error", role: "alert" }, el(doc, "p", {}, s.error))]
        : []),
    );
    const run = s.run;
    if (run?.phase === "running") {
      const line = [
        run.current ? `Searching ${run.current}` : "Starting",
        `${formatCount(run.done)} of ${formatCount(run.total)} schemas`,
        `${formatCount(run.objects.length)} ${run.objects.length === 1 ? "object" : "objects"} found so far`,
      ].join(" · ");
      progress.replaceChildren(
        el(
          doc,
          "p",
          { class: "src-status" },
          el(doc, "span", { class: "desk-spinner", "aria-hidden": "true" }),
          ` ${line}`,
        ),
        el(doc, "progress", {
          class: "desk-progress",
          max: String(Math.max(1, run.total)),
          value: String(run.done),
          "aria-label": "Schemas searched",
        }),
      );
    } else progress.replaceChildren();
    results.draw(run);
  };

  draw();
  return {
    el: root,
    update(/** @type {SourceState} */ next) {
      state = next;
      draw();
    },
  };
}
