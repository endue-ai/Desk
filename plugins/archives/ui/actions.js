// What the person does in an open archive: select and preview a row, open or close a folder, mark
// rows, sort, filter, open an archive inside it one level down and go back up, extract, and stop
// long work. No DOM: archives.js hands it the frame's state and its way to show it.
import { MEMORY_LIMIT } from "./extract.js";
import { folderOf, nameOf } from "./files.js";
import { closeLevels } from "./opening.js";
import { entriesUnder } from "./tree.js";

/**
 * @typedef {import("./opening.js").Level} Level
 * @typedef {import("./tree.js").Sort} Sort
 * @typedef {import("./archives.js").Held} Held
 * @typedef {{
 *   frame: { sort: Sort, filter: string },
 *   current(): Held | undefined, shownLevel(): Level | undefined,
 *   render(): void, preview(): Promise<void>, present(buffer: string): unknown,
 *   say(text: string): void,
 *   openInner(archive: NonNullable<Level["archive"]>, entry: import("./formats/archive.js").Entry,
 *     id: string): Promise<Level>,
 *   extractor: ReturnType<typeof import("./extract.js").createExtractor>,
 *   jobs: ReturnType<typeof import("./jobs.js").createJobs>,
 * }} Frame
 */

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";

/** @param {Frame} app */
export function createActions(app) {
  const { frame, current, shownLevel, render, preview, present, say } = app;
  return {
    /** Select a row and preview it. @param {string} id */
    select(id) {
      const at = shownLevel();
      if (!at?.tree.byId.has(id)) return Promise.resolve();
      at.selected = id;
      render();
      return preview();
    },
    /** Open or close a folder. @param {string} id */
    toggle(id) {
      const at = shownLevel();
      if (!at) return;
      if (at.expanded.has(id)) at.expanded.delete(id);
      else if (at.tree.byId.get(id)?.kind === "folder") at.expanded.add(id);
      render();
    },
    /** Mark a row for "Extract selected", or unmark it. @param {string} id */
    mark(id) {
      const at = shownLevel();
      if (!at?.tree.byId.has(id)) return;
      if (at.marked.has(id)) at.marked.delete(id);
      else at.marked.add(id);
      render();
    },
    /** @param {Sort["by"]} by */
    sort(by) {
      frame.sort = { by, descending: frame.sort.by === by ? !frame.sort.descending : false };
      render();
    },
    /** @param {string} text */
    filter(text) {
      frame.filter = text;
      render();
    },
    /** Open the archive in an entry one level down. @param {string} id */
    async open(id) {
      const file = current();
      const at = shownLevel();
      const entry = at?.tree.byId.get(id)?.entry;
      if (!file || !at?.archive || !entry || entry.kind !== "file") return;
      if (entry.size > MEMORY_LIMIT) return say(`${nameOf(id)} is too large to open here.`);
      try {
        const inner = await app.openInner(at.archive, entry, id);
        if (current() !== file) return closeLevels([inner]);
        // Only an archive opens a level down; a damaged or plain file says why on the status line.
        if (!inner.archive) {
          closeLevels([inner]);
          return say(
            inner.format === "Unknown"
              ? `${nameOf(id)} is not an archive Archives opens.`
              : (inner.note ?? ""),
          );
        }
        file.levels.push(inner);
        say("");
        void present(file.buffer);
      } catch (error) {
        say(aborted(error) ? `Opening ${nameOf(id)} was cancelled.` : message(error));
      }
    },
    /** Back to the archive this one is inside. */
    up() {
      const file = current();
      if (!file || file.levels.length < 2) return;
      closeLevels([/** @type {Level} */ (file.levels.pop())]);
      void present(file.buffer);
    },
    /** Extract the marked rows (or the selected one), or everything. @param {"selected" | "all"} which */
    async extract(which) {
      const file = current();
      const at = shownLevel();
      if (!file || !at) return;
      if (!at.archive) return say(at.note ?? "Nothing to extract.");
      const order = new Map(at.archive.entries.map((e, i) => [e, i]));
      const ids =
        which === "all"
          ? [""]
          : at.marked.size
            ? [...at.marked]
            : at.selected === null
              ? []
              : [at.selected];
      const chosen = new Set(
        ids.flatMap((id) => {
          const node = at.tree.byId.get(id);
          return node ? entriesUnder(node) : [];
        }),
      );
      const list = [...chosen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      const name = file.levels.length > 1 ? at.name : file.name;
      render();
      await app.extractor.extract(at.archive, list, { name, beside: folderOf(file.path) });
      render();
    },
    /** Stop what runs: an extraction between files, an opening, a preview's decode. */
    stop() {
      app.extractor.stop();
      app.jobs.cancelAll();
    },
  };
}
