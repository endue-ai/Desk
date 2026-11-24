// Only the active Notes plugin loads its local viewport module. The native field remains usable
// whenever the module is loading or unavailable, and stays the editor for ordinary notes.
const LARGE_NOTE = 1024 * 1024;

/**
 * @param {HTMLTextAreaElement} field
 * @param {(value: string) => void} edit
 * @param {() => Promise<typeof import("./large-editor.js")>} load
 */
export function createNoteEditor(field, edit, load = () => import("./large-editor.js")) {
  const nativeFocus = field.focus.bind(field);
  const nativeSelection = field.setSelectionRange.bind(field);
  /** @type {typeof import("./large-editor.js").mountLargeEditor | undefined} */
  let mount;
  /** @type {ReturnType<NonNullable<typeof mount>> | undefined} */
  let viewport;
  /** @type {string | undefined} */
  let buffer;
  let large = false;
  let scroll = 0;

  function attach() {
    if (!large || !mount || viewport) return;
    const focused = field.ownerDocument.activeElement === field;
    field.dataset.viewport = "ready";
    try {
      viewport = mount(field, edit, nativeSelection);
      viewport.scroll = scroll;
      if (focused) viewport.focus();
    } catch {
      viewport?.destroy();
      viewport = undefined;
      mount = undefined;
      delete field.dataset.viewport;
      if (focused) nativeFocus();
    }
  }

  // When the asset arrives, the field already holds the current buffer, text and selection,
  // including edits typed into a large note while its editor was loading.
  load().then(
    (module) => {
      mount = module.mountLargeEditor;
      attach();
    },
    () => {},
  );

  field.focus = (options) => {
    if (viewport) viewport.focus();
    else nativeFocus(options);
  };
  field.setSelectionRange = (start, end, direction) => {
    nativeSelection(start, end, direction);
    viewport?.select();
  };
  field.addEventListener("input", () => edit(field.value));
  field.addEventListener("scroll", () => {
    if (!viewport) scroll = field.scrollTop;
  });

  return {
    show(/** @type {string | undefined} */ id, /** @type {string} */ value) {
      if (id !== buffer) {
        viewport?.destroy();
        viewport = undefined;
        delete field.dataset.viewport;
        buffer = id;
        large = false;
        scroll = 0;
      }
      if (id && value.length >= LARGE_NOTE) large = true;
      const changed = field.value !== value;
      if (changed) {
        field.value = value;
        viewport?.reset();
      }
      attach();
      return changed;
    },
    get element() {
      return viewport?.element ?? field;
    },
    get scroll() {
      return viewport?.scroll ?? field.scrollTop;
    },
    set scroll(/** @type {number} */ value) {
      scroll = value;
      if (viewport) viewport.scroll = value;
      else field.scrollTop = value;
    },
    insert(/** @type {string} */ value) {
      field.focus();
      if (viewport) viewport.insert(value);
      else {
        field.setRangeText(value, field.selectionStart, field.selectionEnd, "end");
        edit(field.value);
      }
    },
  };
}
