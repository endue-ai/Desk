// Sheets across a sleep (ADR 0070, ADR 0176): the SDK's keepFiles answers ui.surface.state with the
// open files, the one on screen, the place in each and a CSV's unsaved edits (keep.js); back, the
// file that was on screen opens again where it was, with its edits, without asking for a folder or
// taking the focus, and the others open when they are shown. A file the desk lists that the frame
// lost (it slept, or its page loaded again) opens on show, revert or save, unless the frame closed
// it itself; edits that could not be kept or put back clear the desk's unsaved mark and say so.
import { applyEdits, editsOf, placeOf, readEdit, readPlace } from "./keep.js";
import { editing } from "./save.js";

/**
 * @typedef {import("./sheets.js").Held} Held
 * @typedef {import("./sheets.js").View} View
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
 * @typedef {import("./keep.js").KeptEdit} KeptEdit
 * @typedef {{ show?: boolean, waking?: boolean, edits?: boolean }} How show: the person wants it
 *   on screen now; waking: the window is coming back; edits: put back what the sleep kept unsaved
 */

/**
 * @param {{
 *   surface: import("@endue-ai/plugin-sdk").PluginContext["surface"],
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles, view: View,
 *   load: ReturnType<typeof import("./loading.js").createLoading>["load"],
 *   files(): Held[], shown(): string | null, has(buffer: string): boolean,
 *   hold(file: Held, watchId: string | undefined): Promise<void> | undefined,
 *   present(file: Held): void, unsaved(file: Held): void, marked(buffer: string): void,
 *   say(text: string): void, summary(file: Held): string, busy(): boolean,
 * }} deps hold: take the file for its buffer, following it on disk; present: put it on screen
 *   without the focus; unsaved: tell the desk of its edits; marked: the desk's mark is cleared
 */
export function createWake(deps) {
  const { view, load } = deps;
  const kept = deps.keepFiles(deps.surface, {
    files: () =>
      deps.files().map((f) => ({
        buffer: f.buffer,
        path: f.path,
        place: placeOf(view.where?.(f.buffer), f.watchId),
        edits: editsOf(f.doc, f.reported),
      })),
    shown: deps.shown,
    readPlace,
    readEdit,
  });
  /** Buffers this frame closed: a show of one does not open it again. @type {Set<string>} */
  const closed = new Set();
  /** The file on its way to open again, if any: a show of it waits for it. */
  /** @type {{ buffer: string, done: Promise<void> } | undefined} */
  let underway;
  const keptOf = (/** @type {string} */ buffer) => kept.files().find((f) => f.buffer === buffer);

  /**
   * Open again a file the frame does not hold: where the last sleep left it, with its edits.
   * @param {string} buffer
   * @param {string} path
   * @param {How} how
   * @returns {Promise<Held | undefined>}
   */
  const reopen = async (buffer, path, { show = false, waking = false, edits = true }) => {
    const found = keptOf(buffer);
    const { watchId, ...where } = found?.place ?? {};
    // The zoom is the view's, not the file's: only the file that was on screen brings it back.
    if (found?.place) view.restore?.(buffer, waking ? where : { ...where, zoom: undefined });
    const loaded = await load(buffer, path, { preview: show || waking, focus: show, ask: !waking });
    if (deps.has(buffer) || closed.has(buffer)) return undefined;
    kept.take(buffer);
    /** @type {Held} */
    const file = { ...loaded, ...editing(loaded) };
    let lost = edits && found?.lost === true;
    if (edits && found?.edit) {
      if (applyEdits(file.doc, found.edit)) file.reported = found.edit.reported;
      else lost = true;
    }
    const watching = deps.hold(file, watchId);
    if (waking) deps.present(file);
    deps.unsaved(file);
    // What the desk marks unsaved is not here any more: the file is as it is on disk. A revert
    // clears the mark itself.
    if (edits && (lost || !found)) {
      deps.marked(buffer);
      file.notice = lost
        ? `The unsaved changes to ${file.name} could not be kept while its window slept.`
        : `${file.name} was opened again from disk.`;
    }
    await watching;
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
    /** Back from a sleep, the file that was on screen opens again where it was. */
    start() {
      const back = kept.shown === null ? undefined : keptOf(kept.shown);
      if (!back) return;
      lost(back.buffer, back.path, { waking: true }).then(
        (file) => {
          if (file && deps.shown() === file.buffer) deps.say(deps.summary(file));
        },
        (error) => {
          // A show or a visit meanwhile goes first, and this one gives way quietly.
          if (deps.busy() || deps.shown() !== null) return;
          deps.say(error instanceof Error ? error.message : String(error));
        },
      );
    },
  };
}
