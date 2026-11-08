// The grid's cell editor: a field laid over the cell, holding its value (NULL shown as an empty
// field with NULL as its placeholder). Enter keeps the value and moves down, Tab moves right,
// Escape leaves the cell as it was, leaving the field keeps what was typed. A long or multi-line
// value is better changed in the value viewer (v).

import { el } from "./dom.js";

/**
 * @typedef {{ row: number, col: number, value: string | null }} Editing
 * @typedef {(editing: Editing, value: string | null | undefined, move: "down" | "right" | "none") => void} Commit
 *   `value` is undefined when the cell was left as it was.
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} host The positioned element the cells are drawn in (the grid).
 * @param {Commit} commit
 * @param {() => void} done Called when the field closes, to give the grid its focus back.
 */
export function createCellEditor(doc, host, commit, done) {
  const input = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      class: "desk-field cell-input",
      spellcheck: "false",
      "aria-label": "Cell value",
    })
  );
  /** @type {Editing | null} */
  let at = null;

  const finish = (/** @type {"down" | "right" | "none" | "cancel"} */ how) => {
    const editing = at;
    at = null;
    input.remove();
    if (editing && how !== "cancel") {
      const typed = input.value;
      const value = typed === "" && editing.value === null ? null : typed;
      commit(editing, value === editing.value ? undefined : value, how);
    }
    done();
  };

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      finish("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      finish("right");
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish("cancel");
    }
    event.stopPropagation();
  });
  input.addEventListener("blur", () => {
    if (at) finish("none");
  });

  return {
    /**
     * Open over a cell, with its value, or with `typed` (a key that started the edit) in its place.
     * @param {HTMLElement} cell
     * @param {Editing} editing
     * @param {string} [typed]
     */
    open(cell, editing, typed) {
      at = editing;
      input.value = typed ?? editing.value ?? "";
      input.placeholder = editing.value === null ? "NULL" : "";
      const box = cell.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      input.style.top = `${box.top - origin.top}px`;
      input.style.left = `${box.left - origin.left}px`;
      input.style.width = `${Math.max(box.width, 120)}px`;
      host.append(input);
      input.focus();
      if (typed === undefined) input.select();
    },
    active: () => at !== null,
  };
}
