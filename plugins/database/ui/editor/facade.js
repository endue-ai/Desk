// The console's textarea (`#editor` in index.html) stays the handle the rest of the surface holds:
// view.js reads its value and selection, selects an error's position in it, inserts a dropped file
// at its caret and focuses it. The editor component hides it and answers for it: its value is the
// editor's text, its selection the main selection, and focusing the editor tells its `focusin`
// listeners. A text is turned into a string once per version of it.

import { EditorSelection } from "../vendor/editor-component.mjs";

/**
 * @typedef {import("../vendor/editor-component.mjs").EditorView} View
 * @typedef {import("../vendor/editor-component.mjs").Text} Text
 */

/** @type {WeakMap<Text, string>} */
const strings = new WeakMap();

/** The text as one string, made once per version of it. */
export function textOf(/** @type {Text} */ text) {
  let found = strings.get(text);
  if (found === undefined) {
    found = text.toString();
    strings.set(text, found);
  }
  return found;
}

/**
 * Make `textarea` answer for `view`.
 * @param {HTMLTextAreaElement} textarea
 * @param {View} view
 * @param {{ setReadOnly(readOnly: boolean): void }} hooks
 */
export function attachFacade(textarea, view, hooks) {
  const clamp = (/** @type {unknown} */ n) =>
    Math.max(0, Math.min(view.state.doc.length, Number(n) || 0));
  const define = (/** @type {string} */ name, /** @type {PropertyDescriptor} */ descriptor) =>
    Object.defineProperty(textarea, name, { configurable: true, ...descriptor });
  const replace = (
    /** @type {string} */ text,
    /** @type {number} */ from,
    /** @type {number} */ to,
    /** @type {string} */ mode,
  ) => {
    const main = view.state.selection.main;
    const end = from + text.length;
    const selection =
      mode === "select"
        ? EditorSelection.range(from, end)
        : mode === "start"
          ? EditorSelection.cursor(from)
          : mode === "end"
            ? EditorSelection.cursor(end)
            : undefined;
    view.dispatch({
      changes: { from, to, insert: text },
      selection:
        selection ??
        EditorSelection.range(main.anchor, main.head).map(
          view.state.changes({ from, to, insert: text }),
        ),
      scrollIntoView: true,
      userEvent: "input",
    });
  };

  define("value", {
    get: () => textOf(view.state.doc),
    set: (value) => replace(String(value), 0, view.state.doc.length, "end"),
  });
  define("selectionStart", { get: () => view.state.selection.main.from });
  define("selectionEnd", { get: () => view.state.selection.main.to });
  define("readOnly", {
    get: () => view.state.readOnly,
    set: (value) => hooks.setReadOnly(Boolean(value)),
  });
  Object.assign(textarea, {
    focus: () => view.focus(),
    blur: () => view.contentDOM.blur(),
    select: () => view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }),
    setSelectionRange(/** @type {number} */ start, /** @type {number} */ end) {
      const anchor = clamp(start);
      view.dispatch({
        selection: EditorSelection.range(anchor, Math.max(anchor, clamp(end ?? start))),
        scrollIntoView: true,
        userEvent: "select",
      });
    },
    setRangeText(
      /** @type {string} */ text,
      /** @type {number} */ start = view.state.selection.main.from,
      /** @type {number} */ end = view.state.selection.main.to,
      /** @type {string} */ mode = "preserve",
    ) {
      const from = clamp(start);
      replace(String(text), from, Math.max(from, clamp(end)), mode);
    },
  });
  textarea.hidden = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  // The surface's hint line listens on the textarea; the editor (and its find bar) tells it.
  view.dom.addEventListener("focusin", () =>
    textarea.dispatchEvent(new FocusEvent("focusin", { relatedTarget: null })),
  );
}
