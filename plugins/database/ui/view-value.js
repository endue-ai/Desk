// The value viewer: one cell's whole value in a dialog, as text, as JSON laid out, or as a hex dump
// of its bytes (value.js), with its type and size. Copy takes what is shown (the controller's
// copyValue, which asks first past copy-size.js's limits); when the result can be changed, Change
// keeps the text as the cell's pending value once its type's editor takes it (the reason is said
// when it does not), Set NULL makes it NULL and Set DEFAULT its default (PG-40).
// A geometry opens on its Shape, drawn with its type, SRID and vertex count (PG-46,
// geo/value-shape.js); Copy there copies the value as it came. Escape or Close gives the grid its
// focus back.

import { checkValue } from "./cell-editors/values.js";
import { el } from "./dom.js";
import { DEFAULT, isDefault } from "./edit/values.js";
import { createShapeView, shapeKind } from "./geo/value-shape.js";
import { describeValue } from "./value.js";

/**
 * @typedef {{
 *   row: number, col: number, value: string | null, name: string, type: string, editable: boolean,
 *   reason: string, editor?: import("./cell-editors/resolve.js").Editor, oid?: number,
 * }} Opened
 *   `oid`: the column's type OID, when the result says it.
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {Act} act
 * @param {() => void} back Gives the grid its focus back.
 * @param {import("./geo/client.js").StartWorker} [startWorker] The map's worker, for a shape.
 */
export function createValueViewer(doc, act, back, startWorker) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const form = /** @type {HTMLFormElement} */ (byId("value"));
  const title = byId("value-title");
  const meta = byId("value-meta");
  const tabs = byId("value-tabs");
  const text = /** @type {HTMLTextAreaElement} */ (byId("value-text"));
  const save = /** @type {HTMLButtonElement} */ (byId("value-save"));
  const setNull = /** @type {HTMLButtonElement} */ (byId("value-null"));
  const setDefault = /** @type {HTMLButtonElement} */ (byId("value-default"));
  const error = byId("value-error");
  const shape = createShapeView(doc, act, startWorker);
  text.after(shape.el);
  /** @type {Opened | null} */
  let opened = null;
  /** @type {import("./value.js").ValueView | "shape"} */
  let current = "text";

  const close = () => {
    form.hidden = true;
    shape.hide();
    opened = null;
    back();
  };
  const show = (/** @type {Opened} */ cell, /** @type {typeof current} */ view) => {
    const described = describeValue(cell.value, cell.type);
    const kind = shapeKind(cell);
    /** @type {(typeof current)[]} */
    const views = kind ? ["shape", ...described.views] : described.views;
    current = view;
    tabs.replaceChildren(
      ...views.map((v) =>
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
          v === "json" ? "JSON" : v === "hex" ? "Bytes" : v === "shape" ? "Shape" : "Text",
        ),
      ),
    );
    tabs.hidden = views.length < 2;
    text.value = described.text(view === "shape" ? "text" : view);
    text.hidden = view === "shape";
    // Only the text itself can be changed; JSON laid out or a dump would change the value.
    text.readOnly = !cell.editable || view !== "text";
    save.hidden = !cell.editable;
    setNull.hidden = !cell.editable || cell.editor?.nullable === false;
    setDefault.hidden = !cell.editable || !cell.editor?.hasDefault;
    error.hidden = true;
    const why = cell.editable ? "" : cell.reason ? ` · read-only: ${cell.reason}` : " · read-only";
    const zone =
      cell.editor?.zone && cell.editor.timeZone ? ` · time zone ${cell.editor.timeZone}` : "";
    meta.textContent = `${described.meta}${zone}${why}`;
    if (view !== "shape" || !kind || cell.value === null) return shape.hide();
    void shape.show(String(cell.value), kind).then(
      (words) => {
        if (words && opened === cell) meta.textContent = `${words} · ${meta.textContent}`;
      },
      (failed) => {
        if (opened === cell)
          meta.textContent = `Not drawn: ${failed instanceof Error ? failed.message : String(failed)} · ${meta.textContent}`;
      },
    );
  };

  tabs.addEventListener("click", (event) => {
    const view = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[data-view]");
    if (opened && view)
      show(opened, /** @type {never} */ (/** @type {HTMLElement} */ (view).dataset.view));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const kept = opened && isDefault(opened.value) && text.value === "";
    if (opened?.editable && current === "text" && text.value !== opened.value && !kept) {
      const checked = opened.editor ? checkValue(opened.editor, text.value) : { value: text.value };
      if ("error" in checked) {
        error.textContent = checked.error;
        error.hidden = false;
        return text.focus();
      }
      act("editCell", opened.row, opened.col, checked.value);
    }
    close();
  });
  setNull.addEventListener("click", () => {
    if (opened?.editable) act("editCell", opened.row, opened.col, null);
    close();
  });
  setDefault.addEventListener("click", () => {
    if (opened?.editable) act("editCell", opened.row, opened.col, DEFAULT);
    close();
  });
  text.addEventListener("input", () => {
    error.hidden = true;
  });
  byId("value-copy").addEventListener("click", () => act("copyValue", text.value));
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
      const first = shapeKind(cell)
        ? "shape"
        : (describeValue(cell.value, cell.type).views[0] ?? "text");
      show(cell, first);
      form.hidden = false;
      if (first === "shape")
        /** @type {HTMLElement} */ (tabs.querySelector("[aria-selected=true]") ?? text).focus();
      else text.focus();
    },
  };
}
