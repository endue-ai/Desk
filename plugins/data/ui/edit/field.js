// Editing in the tree, on the page: the edit tier on <desk-edit-tier> (attributes only; the element
// comes from @endue-ai/ui, which main.js defines), and one input that takes the place of a scalar
// row's value. Enter or F2 on the row, or a double click, opens it with the value; Enter or a click
// elsewhere commits, Escape cancels. Keys typed in it stay in it (the tree's arrows do not move the
// selection) while chords reach the desk, Mod+S after committing. It survives the virtual list
// redrawing its row: `place` puts it back in the row's new value cell.

/**
 * @typedef {import("../data.js").Shown} Shown
 * @typedef {import("../tree-view.js").Row} Row
 * @typedef {Row & { branch?: boolean, masked?: boolean }} AnyRow A local row, or a worker's
 * @typedef {object} FieldHooks
 * @property {() => Shown | null} model The file shown
 * @property {() => AnyRow | undefined} selected The tree's selected row
 * @property {(row: AnyRow) => boolean} masked Whether the row's value shows as dots now
 * @property {(path: number[]) => Promise<string>} begin The editor's text for a value
 * @property {(path: number[], text: string) => unknown} commit
 * @property {() => void} redraw Draw the tree's rows again
 * @property {() => void} focus Give the tree the focus back
 * @property {(text: string) => void} say
 */

/**
 * Show the file's edit tier, and why it is read-only when it is.
 * @param {HTMLElement} element The <desk-edit-tier>
 * @param {Shown | null} model
 */
export function showTier(element, model) {
  element.hidden = !model;
  if (!model) return;
  const tier = model.tier ?? "read-only";
  element.setAttribute("tier", tier);
  element.setAttribute("format", model.opened.label);
  if (tier === "read-only" && model.why)
    element.setAttribute("detail", `This file opens for reading: ${model.why}.`);
  else element.removeAttribute("detail");
}

/** The sentence a read-only file's edit gets. */
export const readOnlyText = (/** @type {Shown} */ model) =>
  `${model.name} opens read-only: ${model.why ?? "it is not edited here"}.`;

/**
 * @param {Document} doc
 * @param {HTMLElement} tree The tree element
 * @param {FieldHooks} hooks
 */
export function createEditField(doc, tree, hooks) {
  const input = doc.createElement("input");
  input.type = "text";
  input.className = "desk-field edit";
  input.spellcheck = false;
  input.autocomplete = "off";
  /** @type {{ key: string, path: number[], initial: string } | null} */
  let editing = null;
  /** While the input moves into a redrawn row: its blur is not a click elsewhere. */
  let moving = false;
  let focusNext = false;

  const finish = (/** @type {boolean} */ save) => {
    const was = editing;
    if (!was) return;
    editing = null;
    const text = input.value;
    input.remove();
    hooks.redraw();
    hooks.focus();
    if (save && text !== was.initial) hooks.commit(was.path, text);
  };

  input.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      if (event.key.toLowerCase() === "s") finish(true);
      return;
    }
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      finish(event.key === "Enter");
    }
  });
  for (const type of ["click", "dblclick", "mousedown"])
    input.addEventListener(type, (event) => event.stopPropagation());
  input.addEventListener("blur", () => {
    if (!moving) finish(true);
  });

  /** Open the editor on a row, when the file and the row allow it. */
  const edit = async (/** @type {AnyRow} */ row) => {
    const model = hooks.model();
    const node = row.chain?.at(-1);
    const branch =
      row.group !== undefined ||
      (node ? ["object", "array", "element"].includes(node.kind) : row.branch);
    if (!model || editing) return;
    if ((model.tier ?? "read-only") === "read-only") return hooks.say(readOnlyText(model));
    if (branch) return;
    if (hooks.masked(row)) return hooks.say(`Reveal the value of ${row.label} to edit it.`);
    const path = row.key.split("/").map(Number);
    /** @type {string} */
    let text;
    try {
      text = await hooks.begin(path);
    } catch (error) {
      return hooks.say(error instanceof Error ? error.message : String(error));
    }
    if (hooks.model() !== model || editing) return;
    editing = { key: row.key, path, initial: text };
    input.value = text;
    input.setAttribute("aria-label", `New value of ${row.label}`);
    focusNext = true;
    hooks.redraw();
  };

  // The click before it selected the row.
  tree.addEventListener("dblclick", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const row = hooks.selected();
    if (row && target.closest("[role=treeitem]")) void edit(row);
  });

  return {
    edit,
    /** The tree drew `row` with `cell` as its value: the input takes its place when it edits it. */
    place(/** @type {AnyRow} */ row, /** @type {HTMLElement} */ cell) {
      if (editing?.key !== row.key) return;
      const focused = focusNext || doc.activeElement === input;
      moving = true;
      cell.replaceWith(input);
      moving = false;
      if (!focused) return;
      // The row is not in the page yet while the list draws it.
      queueMicrotask(() => {
        if (editing?.key !== row.key || !input.isConnected) return;
        input.focus();
        if (focusNext) input.select();
        focusNext = false;
      });
    },
    /** Close the editor without committing or drawing (another file is shown). */
    close() {
      editing = null;
      focusNext = false;
      input.remove();
    },
  };
}
