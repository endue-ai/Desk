// The grid's cell editor: a field laid over the cell, holding its value (NULL shown as an empty
// field with NULL as its placeholder, DEFAULT likewise). Enter keeps the value and moves down, Tab
// moves right, Escape leaves the cell as it was, leaving the field keeps what was typed; Alt+N sets
// NULL and Alt+D DEFAULT where the column has one. A cell of any other kind than text opens its
// typed editor instead (cell-editors/, PG-40). A long or multi-line value is better changed in the
// value viewer (v).

import { typed as isTyped, openTyped } from "./cell-editors/index.js";
import { el } from "./dom.js";
import { DEFAULT, isDefault } from "./edit/values.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./cell-editors/resolve.js").Editor} Editor
 * @typedef {{ row: number, col: number, value: string | null, name?: string, type?: string, editor?: Editor }} Editing
 * @typedef {(editing: Editing, value: string | null | undefined, move: "down" | "right" | "none") => void} Commit
 *   `value` is undefined when the cell was left as it was.
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} host The positioned element the cells are drawn in (the grid).
 * @param {Commit} commit
 * @param {() => void} done Called when the field closes, to give the grid its focus back.
 * @param {Act} [act] The grid's actions, for what a typed editor asks (a file's bytes, a word said).
 */
export function createCellEditor(doc, host, commit, done, act = () => undefined) {
  const input = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      class: "desk-field cell-input",
      spellcheck: "false",
      "aria-label": t("cell.label"),
    })
  );
  /** @type {Editing | null} */
  let at = null;
  /** @type {{ close(): void } | null} */
  let panel = null;

  /** Keep `value` (the field's text when not given), or leave the cell as it was. */
  const finish = (
    /** @type {"down" | "right" | "none" | "cancel"} */ how,
    /** @type {string | null | undefined} */ chosen = undefined,
  ) => {
    const editing = at;
    at = null;
    input.remove();
    if (editing && how !== "cancel") {
      const typed = input.value;
      const empty = editing.value === null || isDefault(editing.value);
      const value = chosen !== undefined ? chosen : typed === "" && empty ? editing.value : typed;
      commit(editing, value === editing.value ? undefined : value, how);
    }
    done();
  };

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Enter" && !mod) {
      event.preventDefault();
      finish("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      finish("right");
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish("cancel");
    } else if (event.altKey && !mod && event.code === "KeyN" && at?.editor?.nullable !== false) {
      event.preventDefault();
      finish("down", null);
    } else if (event.altKey && !mod && event.code === "KeyD" && at?.editor?.hasDefault) {
      event.preventDefault();
      finish("down", DEFAULT);
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
      const { editor } = editing;
      if (editor && isTyped(editor)) {
        panel = openTyped(
          doc,
          host,
          cell,
          { value: editing.value, name: editing.name ?? "", editor },
          {
            act,
            finish: (value, how) => {
              panel = null;
              commit(editing, value === editing.value ? undefined : value, how);
              done();
            },
            cancel: () => {
              panel = null;
              done();
            },
          },
        );
        return;
      }
      at = editing;
      const empty = editing.value === null || isDefault(editing.value);
      input.value = typed ?? (empty ? "" : (editing.value ?? ""));
      input.placeholder =
        editing.value === null
          ? t("viewCell.null")
          : isDefault(editing.value)
            ? t("viewCell.default")
            : "";
      input.title = [
        t("cell.keys"),
        editor?.nullable !== false ? t("cell.keyNull") : "",
        editor?.hasDefault ? t("cell.keyDefault") : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const box = cell.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      input.style.top = `${box.top - origin.top}px`;
      input.style.left = `${box.left - origin.left}px`;
      input.style.width = `${Math.max(box.width, 120)}px`;
      host.append(input);
      input.focus();
      if (typed === undefined) input.select();
    },
    active: () => at !== null || panel !== null,
  };
}
