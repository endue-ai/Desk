// The value viewer: one cell's whole value in a dialog, as text, as JSON laid out, or as a hex dump
// of its bytes (value.js), with its type and size. Copy takes what is shown; when the result can be
// changed, Change keeps the text as the cell's pending value and Set NULL makes it NULL. Escape or
// Close gives the grid its focus back.

import { el } from "./dom.js";
import { describeValue } from "./value.js";

/**
 * @typedef {{ row: number, col: number, value: string | null, name: string, type: string, editable: boolean, reason: string }} Opened
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {Act} act
 * @param {(text: string) => boolean} copy
 * @param {() => void} back Gives the grid its focus back.
 */
export function createValueViewer(doc, act, copy, back) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const form = /** @type {HTMLFormElement} */ (byId("value"));
  const title = byId("value-title");
  const meta = byId("value-meta");
  const tabs = byId("value-tabs");
  const text = /** @type {HTMLTextAreaElement} */ (byId("value-text"));
  const save = /** @type {HTMLButtonElement} */ (byId("value-save"));
  const setNull = /** @type {HTMLButtonElement} */ (byId("value-null"));
  /** @type {Opened | null} */
  let opened = null;
  /** @type {import("./value.js").ValueView} */
  let current = "text";

  const close = () => {
    form.hidden = true;
    opened = null;
    back();
  };
  const show = (/** @type {Opened} */ cell, /** @type {import("./value.js").ValueView} */ view) => {
    const described = describeValue(cell.value, cell.type);
    current = view;
    tabs.replaceChildren(
      ...described.views.map((v) =>
        el(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            class: "desk-tab",
            "aria-selected": String(v === view),
            "data-view": v,
          },
          v === "json" ? "JSON" : v === "hex" ? "Bytes" : "Text",
        ),
      ),
    );
    tabs.hidden = described.views.length < 2;
    text.value = described.text(view);
    // Only the text itself can be changed; JSON laid out or a dump would change the value.
    text.readOnly = !cell.editable || view !== "text";
    save.hidden = !cell.editable;
    setNull.hidden = !cell.editable;
    const why = cell.editable ? "" : cell.reason ? ` · read-only: ${cell.reason}` : " · read-only";
    meta.textContent = `${described.meta}${why}`;
  };

  tabs.addEventListener("click", (event) => {
    const view = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[data-view]");
    if (opened && view)
      show(opened, /** @type {never} */ (/** @type {HTMLElement} */ (view).dataset.view));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (opened?.editable && current === "text" && text.value !== opened.value)
      act("editCell", opened.row, opened.col, text.value);
    close();
  });
  setNull.addEventListener("click", () => {
    if (opened?.editable) act("editCell", opened.row, opened.col, null);
    close();
  });
  byId("value-copy").addEventListener("click", () => {
    act(
      "say",
      copy(text.value)
        ? "Copied the value."
        : "The clipboard refused: select the text and press Mod+C.",
    );
  });
  byId("value-close").addEventListener("click", close);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  return {
    /** Open on a cell (undefined: nothing to show). */
    open(/** @type {Opened | undefined} */ cell) {
      if (!cell) return;
      opened = cell;
      title.textContent = cell.name || "Value";
      const first = describeValue(cell.value, cell.type).views[0] ?? "text";
      show(cell, first);
      form.hidden = false;
      text.focus();
    },
  };
}
