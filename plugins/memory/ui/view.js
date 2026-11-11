// The memory inspector's page: a search field, the kinds as tabs, the list with Edit and Forget on
// each fact (Forget on each conversation; a long entry in a few lines until Show all), a field to add
// a fact, and Forget everything (its question is ask.js's dialog). Native controls with the base
// sheet's kit classes (desk-btn, desk-field, desk-tab), so the design system in force draws them.
// Text is set as text, never as HTML.
import { FILTERS, LABELS } from "./model.js";

/** How long a status line that is not an error stays, so the list gets its room back. */
export const STATUS_MS = 6000;

/**
 * @typedef {import("./controller.js").Shown} Shown
 * @typedef {{ filter(f: string): void, search(words: string): void, edit(id: string): void,
 *   cancel(): void, save(id: string, text: string): void, add(text: string): void,
 *   forget(id: string): void, forgetAll(): void }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const pick = (selector) => /** @type {HTMLElement} */ (doc.querySelector(selector));
  const tabs = pick("#kinds");
  const list = pick("#entries");
  const status = pick("#status");
  const search = /** @type {HTMLInputElement} */ (pick("#search"));
  const fact = /** @type {HTMLInputElement} */ (pick("#new-fact"));
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let clearing;

  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== false)
        node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.filter(Boolean));
    return node;
  };
  const button = (label, onclick, extra = {}) =>
    el("button", { type: "button", class: "desk-btn", text: label, onclick, ...extra });

  search.addEventListener("input", () => actions.search(search.value));
  pick("#remember-form").addEventListener("submit", (event) => {
    event.preventDefault();
    actions.add(fact.value);
    fact.value = "";
  });
  pick("#forget-all").addEventListener("click", () => actions.forgetAll());
  // Arrow keys move between the tabs, as a tablist's do.
  tabs.addEventListener("keydown", (event) => {
    const all = [...tabs.querySelectorAll("[role=tab]")];
    const at = all.indexOf(/** @type {Element} */ (doc.activeElement));
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step || at < 0) return;
    event.preventDefault();
    const next = /** @type {HTMLElement} */ (all[(at + step + all.length) % all.length]);
    next.focus();
    next.click();
  });

  const editor = (row) => {
    const field = el("textarea", { class: "desk-field", "aria-label": "The fact", rows: "2" });
    field.value = row.text;
    const form = el(
      "form",
      {
        class: "editor",
        onsubmit: (event) => {
          event.preventDefault();
          actions.save(row.id, field.value);
        },
      },
      field,
      el(
        "div",
        { class: "actions" },
        button("Save", undefined, { type: "submit" }),
        button("Cancel", () => actions.cancel()),
      ),
    );
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") actions.cancel();
    });
    queueMicrotask(() => field.focus());
    return form;
  };

  /** The long rows the person opened whole, kept across redraws. */
  const whole = new Set();

  /** "Show all" on a long row: its few lines, or all of it. */
  const toggle = (row) => {
    const shut = () => !whole.has(row.id);
    const control = button(shut() ? "Show all" : "Show less", undefined, {
      class: "desk-btn desk-btn-quiet more",
      "aria-expanded": String(!shut()),
    });
    control.addEventListener("click", () => {
      if (shut()) whole.add(row.id);
      else whole.delete(row.id);
      control.closest("li")?.classList.toggle("clamped", shut());
      control.textContent = shut() ? "Show all" : "Show less";
      control.setAttribute("aria-expanded", String(!shut()));
    });
    return control;
  };

  const item = (row, editing) =>
    el(
      "li",
      {
        class: `entry entry-${row.kind}${row.long && !editing && !whole.has(row.id) ? " clamped" : ""}`,
        "data-id": row.id,
      },
      editing
        ? editor(row)
        : el(
            "div",
            { class: "body" },
            el("p", { class: "text", text: row.kind === "episode" ? `“${row.text}”` : row.text }),
            row.answer !== undefined ? el("p", { class: "answer", text: row.answer }) : null,
            row.snippet ? el("p", { class: "snippet", text: row.snippet }) : null,
            el(
              "p",
              { class: "meta" },
              row.meta,
              ...row.tags.map((tag) => el("span", { class: "tag", text: tag })),
              row.long ? toggle(row) : null,
            ),
          ),
      editing
        ? null
        : el(
            "div",
            { class: "actions" },
            row.kind === "fact"
              ? button("Edit", () => actions.edit(row.id), { "aria-label": `Edit: ${row.text}` })
              : null,
            button("Forget", () => actions.forget(row.id), { "aria-label": `Forget: ${row.text}` }),
          ),
    );

  return {
    /** @param {Shown} shown */
    show(shown) {
      tabs.replaceChildren(
        ...FILTERS.map((f) =>
          el("button", {
            type: "button",
            class: "desk-tab",
            role: "tab",
            "data-filter": f,
            "aria-selected": String(f === shown.filter),
            tabindex: f === shown.filter ? "0" : "-1",
            text: LABELS[f],
            onclick: () => actions.filter(f),
          }),
        ),
      );
      list.replaceChildren(
        ...(shown.rows.length
          ? shown.rows.map((row) => item(row, row.id === shown.editing))
          : [el("li", { class: "empty", text: shown.empty })]),
      );
      pick("#more").hidden = !shown.more;
      // Nothing of the kind shown to forget; a search may hide what there is.
      /** @type {HTMLButtonElement} */ (pick("#forget-all")).disabled =
        !shown.rows.length && !shown.query;
    },
    /** Say `text` on the status line: for a few seconds, or until the next one when `lasting`. */
    status(text, lasting = false) {
      clearTimeout(clearing);
      status.textContent = text;
      if (text && !lasting) clearing = setTimeout(() => (status.textContent = ""), STATUS_MS);
    },
  };
}
