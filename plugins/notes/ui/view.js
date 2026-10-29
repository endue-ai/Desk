// The DOM for the notes plugin: one text area for the note on screen, named by its file name, with
// its path and an unsaved mark, and a status live region for refusals and errors. The text area is the
// only control. Chords (Mod+S, Mod+O, Mod+W) are never prevented, so the SDK passes them to the desk.

/**
 * @typedef {import("./notes.js").NoteModel} NoteModel
 * @typedef {{ edit(text: string): unknown }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const name = byId("note-name");
  const path = byId("note-path");
  const mark = byId("note-mark");
  const text = /** @type {HTMLTextAreaElement} */ (byId("note-text"));
  const status = byId("status");

  text.addEventListener("input", () => actions.edit(text.value));

  return {
    /** @param {NoteModel | null} model */
    note(model) {
      name.textContent = model ? model.name : "No note open";
      path.textContent = model ? model.path : "";
      mark.hidden = !model?.modified;
      text.hidden = !model;
      // Typing already put this text there: setting it again would move the caret to the end.
      const value = model ? model.text : "";
      if (text.value !== value) text.value = value;
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus() {
      if (!text.hidden) text.focus();
    },
  };
}
