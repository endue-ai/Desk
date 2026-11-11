// Data across a sleep (ADR 0070, ADR 0176): the SDK's keepFiles answers ui.surface.state with the
// open files, the one on screen, how each was shown and its unsaved values (keep.js); back, the file
// that was on screen opens again as it was, its values set again and still marked, without asking
// for a folder or taking the focus, and the others open when they are shown. A file the desk lists
// that the frame lost (it slept, or its page loaded again) opens on show, revert or save, unless the
// frame closed it itself; values that could not be kept or put back clear the desk's unsaved mark
// and say so.
import { editsOf, placeOf, readEdit, readPlace } from "./keep.js";

/**
 * @typedef {import("./data.js").File} File
 * @typedef {{ waking?: boolean, edits?: boolean }} How waking: the window is coming back (no
 *   question, no focus); edits: put back what the sleep kept unsaved
 */

/**
 * @param {{
 *   surface: import("@endue-ai/plugin-sdk").PluginContext["surface"],
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles,
 *   view: { where?(buffer: string): import("./keep.js").Where | undefined,
 *     restore?(buffer: string, where: Partial<import("./keep.js").Where>): void },
 *   load(buffer: string, path: string, ask: boolean): Promise<File>,
 *   files(): File[], shown(): string | null, has(buffer: string): boolean,
 *   hold(file: File, watchId: string | undefined): void, present(file: File): void,
 *   restore(file: File, values: import("./keep.js").Value[]): Promise<boolean>,
 *   marked(buffer: string): void, say(text: string): void, opening(file: File): string,
 *   busy(): boolean,
 * }} deps hold: take the file for its buffer, following it on disk and checking its schema;
 *   present: put it on screen without the focus; restore: set the kept values on it again
 */
export function createWake(deps) {
  const kept = deps.keepFiles(deps.surface, {
    files: () =>
      deps.files().map((f) => ({
        buffer: f.buffer,
        path: f.path,
        place: placeOf(deps.view.where?.(f.buffer), f.watchId),
        edits: editsOf(f),
      })),
    shown: deps.shown,
    readPlace,
    readEdit,
  });
  /** Buffers this frame closed: a show of one does not open it again. @type {Set<string>} */
  const closed = new Set();
  /** @type {{ buffer: string, done: Promise<void> } | undefined} */
  let underway;
  const keptOf = (/** @type {string} */ buffer) => kept.files().find((f) => f.buffer === buffer);

  /**
   * Open again a file the frame does not hold, as the last sleep left it.
   * @param {string} buffer
   * @param {string} path
   * @param {How} how
   * @returns {Promise<File | undefined>}
   */
  const reopen = async (buffer, path, { waking = false, edits = true }) => {
    const found = keptOf(buffer);
    const { watchId, ...where } = found?.place ?? {};
    if (where.mode) deps.view.restore?.(buffer, where);
    let file = await deps.load(buffer, path, !waking);
    const gone = () => {
      if (!deps.has(buffer) && !closed.has(buffer)) return false;
      file.opened.remote?.close();
      return true;
    };
    if (gone()) return undefined;
    let lost = edits && found?.lost === true;
    const edit = edits ? found?.edit : undefined;
    if (edit) {
      const same = file.base?.size === edit.size && file.base?.sum === edit.sum;
      if (same && (await deps.restore(file, edit.values))) file.edited = edit.reported;
      else {
        lost = true;
        // A value that would not go back may have left others set: the file opens as on disk.
        if (same) {
          file.opened.remote?.close();
          file = await deps.load(buffer, path, !waking);
        }
      }
    }
    if (gone()) return undefined;
    kept.take(buffer);
    deps.hold(file, watchId);
    if (waking) deps.present(file);
    // What the desk marks unsaved is not here any more: the file is as it is on disk. A revert
    // clears the mark itself.
    if (edits && (lost || !found)) {
      deps.marked(buffer);
      deps.say(
        lost
          ? `The unsaved changes to ${file.name} could not be kept while its window slept.`
          : `${file.name} was opened again from disk.`,
      );
    } else if (waking) deps.say(deps.opening(file));
    return file;
  };

  /**
   * Open again a file the desk lists that the frame lost, unless it closed it itself; resolves
   * with it, or undefined when there is nothing to open again.
   * @param {string} buffer
   * @param {string | undefined} path the desk's, when the frame kept none
   * @param {How} [how]
   */
  const lost = (buffer, path, how = {}) => {
    const from = keptOf(buffer)?.path ?? path;
    if (!from || deps.has(buffer) || closed.has(buffer)) return Promise.resolve(undefined);
    const opening = reopen(buffer, from, how);
    const done = opening.then(
      () => {},
      () => {},
    );
    underway = { buffer, done };
    void done.then(() => {
      if (underway?.done === done) underway = undefined;
    });
    return opening;
  };

  return {
    lost,
    /** Wait for the file of `buffer` if it is on its way to open again. */
    async settled(/** @type {string} */ buffer) {
      if (underway?.buffer === buffer) await underway.done;
    },
    /** A visit opened `buffer`: nothing kept of it is wanted any more. */
    opened(/** @type {string} */ buffer) {
      kept.take(buffer);
      closed.delete(buffer);
    },
    /** The desk closed `buffer`; true when the frame held only what a sleep kept of it. */
    closed(/** @type {string} */ buffer) {
      closed.add(buffer);
      return kept.take(buffer) !== undefined;
    },
    /** Back from a sleep, the file that was on screen opens again as it was. */
    start() {
      const back = kept.shown === null ? undefined : keptOf(kept.shown);
      if (!back) return;
      lost(back.buffer, back.path, { waking: true }).catch((error) => {
        // A show or a visit meanwhile goes first, and this one gives way quietly.
        if (deps.busy() || deps.shown() !== null || error?.name === "AbortError") return;
        deps.say(error instanceof Error ? error.message : String(error));
      });
    },
  };
}
