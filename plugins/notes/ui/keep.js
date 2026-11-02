// What notes keeps when the desk unloads its surface while nobody sees it (ui.surface.state, ADR
// 0070), and how it reads that back: the open notes in order, the text of the unsaved ones only
// (saved text is on disk, and the desk keeps at most 64 KiB), the watches they had, the note on
// screen, its caret and its scroll.

/**
 * @typedef {{ start: number, end: number, scroll: number }} Place
 * @typedef {{ buffer: string, path: string, modified: boolean, reported?: boolean, text?: string, watchId?: string }} KeptNote
 * @typedef {{ notes: KeptNote[], shown: string | null, caret: [number, number], scroll: number }} Kept
 * @typedef {{ buffer: string, path: string, text: string, modified: boolean, reported: boolean, watchId?: string }} OpenNote
 */

/**
 * @param {OpenNote[]} notes
 * @param {string | null} shown
 * @param {Place} at
 * @returns {Kept}
 */
export function keep(notes, shown, at) {
  return {
    notes: notes.map(({ buffer, path, modified, reported, text, watchId }) => ({
      buffer,
      path,
      modified,
      ...(modified ? { reported, text } : {}),
      ...(watchId ? { watchId } : {}),
    })),
    shown,
    caret: [at.start, at.end],
    scroll: at.scroll,
  };
}

const isText = (/** @type {unknown} */ v) => typeof v === "string";
const isCount = (/** @type {unknown} */ v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The kept state, or null when `value` is not one (a cold start, or another version's).
 * @param {unknown} value
 * @returns {Kept | null}
 */
export function readKept(value) {
  const kept = /** @type {Partial<Kept> | null} */ (
    typeof value === "object" && value !== null ? value : null
  );
  if (!kept || !Array.isArray(kept.notes) || !Array.isArray(kept.caret)) return null;
  const notes = kept.notes.filter(
    (n) =>
      isText(n?.buffer) &&
      isText(n?.path) &&
      typeof n?.modified === "boolean" &&
      (n.text === undefined || isText(n.text)) &&
      (n.watchId === undefined || isText(n.watchId)),
  );
  const [start, end] = kept.caret;
  return {
    notes,
    shown: isText(kept.shown) ? /** @type {string} */ (kept.shown) : null,
    caret: [isCount(start) ? start : 0, isCount(end) ? end : 0],
    scroll: isCount(kept.scroll) ? /** @type {number} */ (kept.scroll) : 0,
  };
}
