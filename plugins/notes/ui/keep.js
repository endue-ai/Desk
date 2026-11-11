// What notes keeps when the desk puts its window to sleep (ui.surface.state, ADR 0070, ADR 0176),
// through the SDK's keepFiles: every open note with its watch, the caret and scroll of the one on
// screen, and the unsaved text: whole while it fits, else only what changed since it was saved
// (textChange), so typing in a 100 KB note still fits the 64 KiB the desk keeps. And how a kept note
// reads back: its text from the kept edit, or from disk with the kept change put back on it.

/**
 * @typedef {{ start: number, end: number, scroll: number }} Place
 * @typedef {import("@endue-ai/plugin-sdk").TextChange} TextChange
 * @typedef {{ watchId?: string, caret?: [number, number], scroll?: number }} KeptPlace
 * @typedef {{ text: string, reported: boolean } | { change: TextChange, reported: boolean }} KeptEdit
 * @typedef {{ buffer: string, path: string, text: string, saved?: string, modified: boolean, reported: boolean, watchId?: string }} OpenNote
 * @typedef {{ keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles, textChange: typeof import("@endue-ai/plugin-sdk").textChange, applyTextChange: typeof import("@endue-ai/plugin-sdk").applyTextChange, isTextChange: typeof import("@endue-ai/plugin-sdk").isTextChange }} KeepSdk
 * @typedef {import("@endue-ai/plugin-sdk").OpenFile<KeptPlace, KeptEdit>} OpenFile
 * @typedef {import("@endue-ai/plugin-sdk").KeptFile<KeptPlace, KeptEdit>} KeptFile
 */

/**
 * The files keepFiles keeps, one per open note in the order they opened: the watch, the caret and
 * scroll of the note on screen, and an unsaved note's text, then its change from the saved text.
 * @param {OpenNote[]} notes
 * @param {string | null} shown
 * @param {Place} at
 * @param {KeepSdk["textChange"]} textChange
 * @returns {OpenFile[]}
 */
export function openFiles(notes, shown, at, textChange) {
  return notes.map(({ buffer, path, text, saved, modified, reported, watchId }) => {
    /** @type {KeptPlace} */
    const place = {
      ...(watchId ? { watchId } : {}),
      ...(buffer === shown ? { caret: [at.start, at.end], scroll: at.scroll } : {}),
    };
    /** @type {KeptEdit[]} */
    const edits = modified
      ? [
          { text, reported },
          ...(saved === undefined ? [] : [{ change: textChange(saved, text), reported }]),
        ]
      : [];
    return {
      buffer,
      path,
      ...(Object.keys(place).length > 0 ? { place } : {}),
      ...(edits.length > 0 ? { edits } : {}),
    };
  });
}

const isText = (/** @type {unknown} */ v) => typeof v === "string";
const isCount = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * A kept place as notes keeps one, or undefined (another version's).
 * @param {unknown} value
 * @returns {KeptPlace | undefined}
 */
export function readPlace(value) {
  const place = /** @type {Partial<KeptPlace> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!place) return undefined;
  const caret = Array.isArray(place.caret) ? place.caret : undefined;
  return {
    ...(isText(place.watchId) ? { watchId: place.watchId } : {}),
    ...(caret
      ? { caret: [isCount(caret[0]) ? caret[0] : 0, isCount(caret[1]) ? caret[1] : 0] }
      : {}),
    ...(isCount(place.scroll) ? { scroll: place.scroll } : {}),
  };
}

/**
 * A kept edit as notes keeps one, or undefined: the note then comes back as saved.
 * @param {KeepSdk["isTextChange"]} isTextChange
 * @returns {(value: unknown) => KeptEdit | undefined}
 */
export const readEdit = (isTextChange) => (value) => {
  const edit = /** @type {{ text?: unknown, change?: unknown, reported?: unknown } | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  const reported = edit?.reported === true;
  if (typeof edit?.text === "string") return { text: edit.text, reported };
  if (isTextChange(edit?.change)) return { change: edit.change, reported };
  return undefined;
};

/**
 * The text a kept note opens with, from the kept edit and the text on disk (undefined: not read).
 * `lost` when it had unsaved text that cannot be put back: it opens as saved.
 * @param {KeptFile} kept
 * @param {string | undefined} disk
 * @param {KeepSdk["applyTextChange"]} applyTextChange
 * @returns {{ text: string, saved?: string, modified: boolean, reported: boolean, lost: boolean } | undefined}
 */
export function keptText(kept, disk, applyTextChange) {
  const edit = kept.edit;
  const saved = disk === undefined ? {} : { saved: disk };
  if (edit && "text" in edit)
    return { text: edit.text, ...saved, modified: true, reported: edit.reported, lost: false };
  if (disk === undefined) return undefined;
  const text = edit ? applyTextChange(disk, edit.change) : undefined;
  if (edit && text !== undefined)
    return { text, saved: disk, modified: true, reported: edit.reported, lost: false };
  return { text: disk, saved: disk, modified: false, reported: false, lost: !!edit || !!kept.lost };
}
