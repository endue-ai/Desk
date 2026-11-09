// The DOM for the notes plugin: one text area for the note on screen, named by its file name, with
// its path, unsaved mark and counts, and a status live region for refusals and errors. The text area is
// the only control. Chords (Mod+S, Mod+O, Mod+W) are never prevented, so the SDK passes them to the desk.

/**
 * @typedef {import("./notes.js").NoteModel} NoteModel
 * @typedef {import("./counter.js").Counter} Counter
 * @typedef {{ edit(text: string): unknown }} Actions
 */

/** How long a new note's count may take before the label says it is counting. */
const COUNTING_AFTER_MS = 300;
/** Typing counts once the keys pause, so a key in a long note waits for nothing but the text area. */
const TYPING_PAUSE_MS = 200;

/**
 * @param {Document} doc
 * @param {Actions} actions
 * @param {Counter} counter counts in a worker (counter.js), never on this thread
 */
export function createView(doc, actions, counter) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const name = byId("note-name");
  const path = byId("note-path");
  const mark = byId("note-mark");
  const count = byId("note-count");
  const text = /** @type {HTMLTextAreaElement} */ (byId("note-text"));
  const status = byId("status");
  /** The text the label counts, and the text being counted. @type {string | undefined} */
  let counted;
  /** @type {string | undefined} */
  let asked;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let slow;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let typed;

  /**
   * Count a text in the worker. While typing, the label keeps the last counts until the new ones
   * come; a note just shown says "Counting…" when its count takes a while.
   * @param {string} value
   * @param {boolean} fresh the text came from a file, not from typing
   */
  function updateCount(value, fresh) {
    if (value === counted || value === asked) return;
    asked = value;
    clearTimeout(slow);
    if (fresh) {
      count.textContent = "";
      slow = setTimeout(() => {
        if (asked === value) count.textContent = "Counting…";
      }, COUNTING_AFTER_MS);
    }
    counter.count(value).then(
      ({ words, characters }) => {
        if (asked !== value) return;
        clearTimeout(slow);
        asked = undefined;
        counted = value;
        count.textContent = `${words} words · ${characters} characters`;
      },
      () => {
        // Cancelled for a newer text, which shows its own counts; or the worker stopped.
        if (asked !== value) return;
        clearTimeout(slow);
        asked = counted = undefined;
        count.textContent = "";
      },
    );
  }

  /** A typed text, counted once the keys pause. Reading a long text area's value costs, so once. */
  const typing = (/** @type {string} */ value) => {
    clearTimeout(typed);
    typed = setTimeout(() => updateCount(value, false), TYPING_PAUSE_MS);
    actions.edit(value);
  };
  text.addEventListener("input", () => typing(text.value));
  const main = /** @type {HTMLElement} */ (doc.querySelector("main"));

  return {
    /** @param {NoteModel | null} model */
    note(model) {
      name.textContent = model ? model.name : "No note open";
      path.textContent = model ? model.path : "";
      mark.hidden = !model?.modified;
      text.hidden = !model;
      // Typing already put this text there: setting it again would move the caret to the end.
      const value = model ? model.text : "";
      const fresh = text.value !== value;
      if (fresh) text.value = value;
      clearTimeout(typed);
      if (model) updateCount(value, fresh);
      else {
        counter.cancel();
        clearTimeout(slow);
        asked = counted = undefined;
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

    /** The whole page takes drops (ADR 0119): on the note when one is open, else on the page. */
    dropTarget: doc,
    landing: () => (text.hidden ? main : text),

    /** Put dropped text in at the caret, over the selection, as typing it would. */
    insert(/** @type {string} */ value) {
      if (text.hidden) return;
      text.focus();
      text.setRangeText(value, text.selectionStart, text.selectionEnd, "end");
      typing(text.value);
    },

    /** Put the caret and the scroll back, without taking the focus. */
    place(/** @type {{ start: number, end: number, scroll: number }} */ at) {
      text.setSelectionRange(at.start, at.end);
      text.scrollTop = at.scroll;
    },
  };
}
