// The typed cell editors (PG-40, ADR 0287): a cell is edited by its column's type. resolve.js picks
// the editor (pg-types.js reads PostgreSQL's types), each kind has a module of its own (its check and
// its controls), panel.js is the popover they open in, values.js their values and literals without
// the DOM. view-cell.js opens one here for every kind but text, which keeps its field over the cell.

import { t } from "../strings/index.js";
import { openPanel } from "./panel.js";
import { KINDS } from "./values.js";

/**
 * @typedef {import("./resolve.js").Editor} Editor
 * @typedef {import("./panel.js").Hooks} Hooks
 * @typedef {{ value: string | null, name: string, editor: Editor }} Opened
 */

/** Whether a cell of this editor opens a popover (every kind but text). */
export const typed = (/** @type {Editor | undefined} */ editor) =>
  Boolean(editor && editor.kind !== "text" && KINDS[editor.kind]?.view);

/**
 * Open the editor of a cell's kind at the cell.
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {HTMLElement} anchor
 * @param {Opened} opened
 * @param {Hooks} hooks
 */
export function openTyped(doc, host, anchor, opened, hooks) {
  const view = KINDS[opened.editor.kind]?.view;
  if (!view)
    throw new Error(t("cellEditors.index.noEditorFor", { kind: String(opened.editor.kind) }));
  return openPanel(doc, host, anchor, opened, view, hooks);
}
