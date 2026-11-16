// The explorer's find bar (#313) as state: which folder it narrows and by what, and the search below
// it, one at a time (a new one stops the last), each result opened or revealed in its folder. What a
// search found or why it stopped is said on the status line.
import { FOLDERS, searchBelow } from "./find.js";
import { nameOf } from "./tree.js";

/**
 * @typedef {import("./find.js").Found} Found
 * @typedef {{ folder: string, query: string, below: boolean, results?: Found[], busy?: boolean }} FindModel
 */

/**
 * @param {{ list(folder: string): Promise<import("@endue-ai/bridge").DirEntry[]>, say(text: string): void,
 *   render(): void, open(path: string): Promise<unknown>, reveal(path: string): Promise<unknown>,
 *   show?(model: FindModel | null): void }} act
 * @param {{ folder(): string | undefined, showHidden(): boolean }} state
 */
export function createFinding(act, state) {
  /** @type {FindModel | null} */
  let model = null;
  /** @type {AbortController | undefined} */
  let running;

  const shown = () => act.show?.(model && { ...model });
  const start = (/** @type {string | undefined} */ folder) => {
    const at = folder ?? model?.folder ?? state.folder();
    if (!at) throw new Error("Add a folder to the explorer first.");
    model = { folder: at, query: model?.query ?? "", below: model?.below ?? false };
    return model;
  };

  /** Narrow the folder to names that hold `query`; an empty query shows every row again. */
  const filter = (/** @type {string} */ query, /** @type {string | undefined} */ folder) => {
    const at = start(folder);
    running?.abort();
    model = { folder: at.folder, query, below: false };
    act.render();
    shown();
    return { folder: at.folder, query };
  };

  /** Walk the folders below for `query`; the results, also when stopped. */
  const below = async (/** @type {string} */ query, /** @type {string | undefined} */ folder) => {
    const at = start(folder);
    running?.abort();
    const mine = new AbortController();
    running = mine;
    model = { folder: at.folder, query, below: true, results: [], busy: true };
    act.render();
    shown();
    const found = await searchBelow(act.list, at.folder, query, {
      showHidden: state.showHidden(),
      signal: mine.signal,
    });
    // A newer search said its own words: this one's are stale.
    if (running !== mine) return found.results;
    running = undefined;
    model = { ...model, results: found.results, busy: false };
    shown();
    const count = found.results.length;
    const where = nameOf(at.folder);
    if (found.stopped === "cancelled") act.say("Search stopped.");
    else if (found.stopped === "limit") act.say(`Stopped at ${count} found below ${where}.`);
    else if (found.stopped === "folders")
      act.say(`Stopped after ${FOLDERS} folders: ${count} found below ${where}.`);
    else
      act.say(
        count === 0 ? `Nothing is named so below ${where}.` : `${count} found below ${where}.`,
      );
    return found.results;
  };

  const stop = () => running?.abort();
  /** The bar closes: every row shows again. */
  const close = () => {
    stop();
    model = null;
    act.render();
    shown();
  };

  return {
    /** The narrowing the tree shows, if any. */
    narrowing: () => (model && !model.below && model.query !== "" ? model : null),
    /** Open the bar on the selected folder, narrowed by `query` when given. */
    open: (/** @type {string | undefined} */ query) => {
      const at = start(undefined);
      if (query !== undefined) return filter(query);
      shown();
      return { folder: at.folder, query: at.query };
    },
    filter,
    below,
    stop,
    close,
    openFound: (/** @type {string} */ path) => act.open(path),
    revealFound: async (/** @type {string} */ path) => {
      close();
      return act.reveal(path);
    },
  };
}
