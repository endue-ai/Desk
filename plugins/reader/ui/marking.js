// The person's bookmarks and notes on the file on screen: added and removed in memory, kept in the
// reader's store (marks.js) when they fit, put back when they do not, and said on the status line.
import { marksFit, NOTE_MAX } from "./marks.js";

/**
 * @typedef {import("./reader.js").Open} Open
 * @typedef {import("./reader.js").ShownModel} ShownModel
 * @typedef {import("./reader.js").View} View
 * @typedef {import("./marks.js").At} At
 */

/**
 * @param {{ current(): Open | undefined, keep(file: Open): Promise<boolean>, view: View,
 *   model(file: Open): ShownModel, showing(file: Open): boolean }} deps
 */
export function createMarking({ current, keep, view, model, showing }) {
  /** The marks changed: keep them and show the panel again. */
  const changed = async (
    /** @type {Open} */ file,
    /** @type {string} */ said,
    /** @type {() => void} */ undo,
  ) => {
    const full = !marksFit(file.path, file);
    if (full) undo();
    const ok = !full && (await keep(file));
    if (!showing(file)) return;
    view.marks(model(file));
    view.status(
      ok
        ? said
        : full
          ? "This file's notes are full; remove a note or a bookmark first."
          : "The reader could not keep that: its store refused it.",
    );
  };

  return {
    bookmark(/** @type {At} */ at, /** @type {string} */ label) {
      const file = current();
      if (!file) return;
      const bookmark = { unit: at.unit, offset: at.offset, label, added: new Date().toISOString() };
      file.bookmarks = [...file.bookmarks, bookmark].sort(
        (a, b) => a.unit - b.unit || a.offset - b.offset,
      );
      return changed(file, `Bookmarked ${label}.`, () => {
        file.bookmarks = file.bookmarks.filter((item) => item !== bookmark);
      });
    },
    note(/** @type {At} */ at, /** @type {string} */ text) {
      const file = current();
      const trimmed = text.trim().slice(0, NOTE_MAX);
      if (!file || !trimmed) return;
      const note = {
        unit: at.unit,
        offset: at.offset,
        text: trimmed,
        added: new Date().toISOString(),
      };
      file.notes = [...file.notes, note];
      return changed(file, "Note kept.", () => {
        file.notes = file.notes.filter((item) => item !== note);
      });
    },
    forget(/** @type {"bookmarks" | "notes"} */ kind, /** @type {number} */ index) {
      const file = current();
      if (!file?.[kind][index]) return;
      const bookmark = kind === "bookmarks" ? file.bookmarks[index] : undefined;
      const note = kind === "notes" ? file.notes[index] : undefined;
      file[kind] = file[kind].filter((_, i) => i !== index);
      return changed(file, kind === "bookmarks" ? "Bookmark removed." : "Note removed.", () => {
        if (bookmark && !file.bookmarks.includes(bookmark))
          file.bookmarks = [
            ...file.bookmarks.slice(0, index),
            bookmark,
            ...file.bookmarks.slice(index),
          ];
        if (note && !file.notes.includes(note))
          file.notes = [...file.notes.slice(0, index), note, ...file.notes.slice(index)];
      });
    },
  };
}
