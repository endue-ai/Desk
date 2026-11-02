// Editing a cell in the formula bar (ADR 0071). F2, a double-click or typing on the grid starts an
// edit of the active cell, and so does clicking the bar; Enter commits and moves down (Shift+Enter
// up), Tab right (Shift+Tab left), Escape puts the cell's text back, and leaving the bar commits.
// Only a cell the file has is edited: the bar is read-only everywhere else. A key with Mod or Alt is
// never taken, so the desk's chords pass; while an input method composes, the keys are its own.

/**
 * @typedef {{ r: number, c: number }} Address
 * @typedef {{
 *   active(): Address | undefined, editable(r: number, c: number): boolean,
 *   text(r: number, c: number): string, commit(r: number, c: number, text: string): unknown,
 *   move(dr: number, dc: number): void,
 * }} EditorActions text: what the bar shows for a cell; move: the selection after a commit
 */

const STEPS = /** @type {Record<string, [number, number]>} */ ({ Enter: [1, 0], Tab: [0, 1] });

/**
 * @param {{ root: HTMLElement, scroller: HTMLElement, bar: HTMLInputElement }} parts
 * @param {EditorActions} actions
 */
export function createEditor({ root, scroller, bar }, actions) {
  /** The cell being edited, from the start of an edit until it is committed or cancelled. */
  /** @type {Address | undefined} */
  let editing;

  const editable = (/** @type {Address | undefined} */ at) =>
    at !== undefined && actions.editable(at.r, at.c);

  /** Start editing the active cell, with `value` in place of its text when given. */
  const begin = (/** @type {string | undefined} */ value) => {
    const at = actions.active();
    if (!editable(at)) return false;
    editing = at;
    bar.readOnly = false;
    if (value !== undefined) bar.value = value;
    bar.focus();
    bar.setSelectionRange(bar.value.length, bar.value.length);
    return true;
  };

  const finish = (/** @type {boolean} */ commit) => {
    const at = editing;
    editing = undefined;
    if (!at) return;
    if (commit) actions.commit(at.r, at.c, bar.value);
    else bar.value = actions.text(at.r, at.c);
  };

  root.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.isComposing) return;
    const printable = event.key.length === 1;
    if (event.key !== "F2" && !printable) return;
    if (begin(printable ? event.key : undefined)) event.preventDefault();
  });
  scroller.addEventListener("dblclick", () => begin(undefined));
  bar.addEventListener("focus", () => {
    if (!editing && !bar.readOnly) editing = actions.active();
  });
  bar.addEventListener("keydown", (event) => {
    if (!editing || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = STEPS[event.key];
    if (!step && event.key !== "Escape") return;
    event.preventDefault();
    finish(Boolean(step));
    if (step)
      actions.move(event.shiftKey ? -step[0] : step[0], event.shiftKey ? -step[1] : step[1]);
    root.focus();
  });
  bar.addEventListener("blur", () => finish(true));

  return {
    /**
     * The selection moved or the sheet was drawn again: the bar shows the active cell's text and
     * edits it only where the file has one. An edit in progress keeps its text.
     */
    show(/** @type {string} */ text) {
      if (editing) return;
      bar.value = text;
      bar.readOnly = !editable(actions.active());
    },
    /** A save is coming (Mod+S reaches the desk from the bar): an edit in progress is committed. */
    commit: () => finish(true),
    /** Another file is on screen: an edit in progress is dropped. */
    reset() {
      editing = undefined;
    },
  };
}
