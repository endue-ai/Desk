// The DOM for the notes plugin: one text area for the note on screen, named by its file name, with
// its path, unsaved mark and counts, and a status live region for refusals and errors. The text area is
// the only control. Chords (Mod+S, Mod+O, Mod+W) are never prevented, so the SDK passes them to the desk.

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
  const count = byId("note-count");
  const text = /** @type {HTMLTextAreaElement} */ (byId("note-text"));
  const status = byId("status");
  const words = new Intl.Segmenter(undefined, { granularity: "word" });
  const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  /** @type {string | undefined} */
  let counted;

  /** @param {string} value */
  function updateCount(value) {
    if (counted === value) return;
    counted = value;
    let wordCount = 0;
    let characterCount = 0;
    for (const segment of words.segment(value)) if (segment.isWordLike) wordCount++;
    for (const _ of characters.segment(value)) characterCount++;
    count.textContent = `${wordCount} words · ${characterCount} characters`;
  }

  text.addEventListener("input", () => {
    updateCount(text.value);
    actions.edit(text.value);
  });

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
      if (model) updateCount(value);
      else {
        counted = undefined;
        count.textContent = "";
      }
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus() {
      if (!text.hidden) text.focus();
    },

    /** Where the caret and the scroll are, to come back to (ADR 0070). */
    where() {
      return { start: text.selectionStart, end: text.selectionEnd, scroll: text.scrollTop };
    },

    /** Put the caret and the scroll back, without taking the focus. */
    place(/** @type {{ start: number, end: number, scroll: number }} */ at) {
      text.setSelectionRange(at.start, at.end);
      text.scrollTop = at.scroll;
    },
  };
}
