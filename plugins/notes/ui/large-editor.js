// The native field keeps the complete text for Notes' preview, saves and selection API.
// CodeMirror lays out only the visible lines and keeps ordinary browser text input and composition.
import {
  defaultKeymap,
  EditorState,
  EditorView,
  history,
  historyKeymap,
  keymap,
} from "./vendor/editor/editor-component.mjs";

/**
 * @param {HTMLTextAreaElement} field
 * @param {(value: string) => void} edit
 * @param {(start: number, end: number, direction?: "forward" | "backward" | "none") => void} nativeSelection
 */
export function mountLargeEditor(field, edit, nativeSelection) {
  let pendingText = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let finishComposition;

  function syncField(/** @type {EditorView} */ view, /** @type {boolean} */ docChanged) {
    pendingText ||= docChanged;
    if (view.compositionStarted) return;
    const value = pendingText ? view.state.doc.toString() : undefined;
    pendingText = false;
    const changed = value !== undefined && field.value !== value;
    if (changed) field.value = value;
    const range = view.state.selection.main;
    const direction = range.head < range.anchor ? "backward" : "forward";
    if (
      field.selectionStart !== range.from ||
      field.selectionEnd !== range.to ||
      (!range.empty && field.selectionDirection !== direction)
    ) {
      nativeSelection(range.from, range.to, direction);
    }
    if (changed) edit(value);
  }

  const extensions = [
    EditorView.lineWrapping,
    EditorView.editorAttributes.of({ class: "note-viewport" }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({
      "aria-labelledby": field.getAttribute("aria-labelledby") || "note-name",
      "aria-describedby": field.getAttribute("aria-describedby") || "note-detail",
      "aria-multiline": "true",
      spellcheck: "false",
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) syncField(update.view, update.docChanged);
    }),
    EditorView.domEventObservers({
      compositionend(_event, view) {
        // Chromium can deliver the final DOM mutation after compositionend.
        // Keep provisional text inside the editor until it accepts or cancels the candidate.
        clearTimeout(finishComposition);
        finishComposition = setTimeout(() => {
          if (pendingText) syncField(view, false);
        }, 0);
      },
    }),
  ];
  const selection = () =>
    field.selectionDirection === "backward"
      ? { anchor: field.selectionEnd, head: field.selectionStart }
      : { anchor: field.selectionStart, head: field.selectionEnd };
  const state = () => EditorState.create({ doc: field.value, selection: selection(), extensions });
  const view = new EditorView({ state: state() });
  field.after(view.dom);
  return {
    element: view.dom,
    focus: () => view.focus(),
    destroy() {
      clearTimeout(finishComposition);
      view.destroy();
    },
    reset() {
      clearTimeout(finishComposition);
      pendingText = false;
      view.setState(state());
    },
    select() {
      const next = selection();
      const current = view.state.selection.main;
      if (next.anchor !== current.anchor || next.head !== current.head) {
        view.dispatch({ selection: next, scrollIntoView: true });
      }
    },
    insert(/** @type {string} */ value) {
      view.dispatch(view.state.replaceSelection(value), {
        scrollIntoView: true,
        userEvent: "input",
      });
    },
    get scroll() {
      return view.scrollDOM.scrollTop;
    },
    set scroll(/** @type {number} */ value) {
      view.scrollDOM.scrollTop = value;
    },
  };
}
