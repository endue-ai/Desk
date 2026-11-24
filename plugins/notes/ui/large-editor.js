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
      if (update.docChanged) field.value = update.state.doc.toString();
      if (update.docChanged || update.selectionSet) {
        const range = update.state.selection.main;
        nativeSelection(range.from, range.to, range.head < range.anchor ? "backward" : "forward");
      }
      if (update.docChanged) edit(field.value);
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
    destroy: () => view.destroy(),
    reset: () => view.setState(state()),
    select: () => view.dispatch({ selection: selection(), scrollIntoView: true }),
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
