// Search in a terminal's scrollback (TERM-E08) over xterm's search addon, without the DOM: the query,
// match case, regular expression and whole word, next and previous, and which match of how many is
// on screen. searchbar.js draws it.

/**
 * @typedef {{ caseSensitive: boolean, regex: boolean, wholeWord: boolean }} Flags
 * @typedef {{ query: string, flags: Flags, error: string | null, label: string }} State
 * @typedef {{
 *   findNext(term: string, options?: object): boolean,
 *   findPrevious(term: string, options?: object): boolean,
 *   clearDecorations(): void,
 *   onDidChangeResults(listener: (e: { resultIndex: number, resultCount: number }) => void): unknown,
 * }} SearchAddon
 */

/**
 * @param {SearchAddon} addon
 * @param {{ decorations?: object | (() => object | undefined), render(state: State): void }} options
 *   decorations: the highlights' colours (a function reads them again on every search)
 */
export function createSearch(addon, { decorations, render }) {
  /** @type {State} */
  const state = {
    query: "",
    flags: { caseSensitive: false, regex: false, wholeWord: false },
    error: null,
    label: "",
  };
  const draw = (/** @type {string} */ label) => {
    state.label = label;
    render({ ...state, flags: { ...state.flags } });
  };
  addon.onDidChangeResults(({ resultIndex, resultCount }) => {
    if (state.query === "" || state.error) return;
    draw(
      resultCount === 0
        ? "No results"
        : resultIndex < 0
          ? `${resultCount} matches`
          : `${resultIndex + 1} of ${resultCount}`,
    );
  });

  /** Whether the query can be searched as the flags say; an invalid expression is said. */
  const valid = () => {
    state.error = null;
    if (!state.flags.regex) return true;
    try {
      new RegExp(state.query, "u");
      return true;
    } catch (error) {
      state.error = `Not a regular expression: ${/** @type {Error} */ (error).message}`;
      draw(state.error);
      return false;
    }
  };

  const search = (/** @type {"next" | "previous"} */ direction, incremental = false) => {
    if (state.query === "") {
      addon.clearDecorations();
      draw("");
      return false;
    }
    if (!valid()) return false;
    const colors = typeof decorations === "function" ? decorations() : decorations;
    const options = { ...state.flags, incremental, decorations: colors };
    return direction === "next"
      ? addon.findNext(state.query, options)
      : addon.findPrevious(state.query, options);
  };

  return {
    /** Find `query` from the match on screen, forward or back. */
    find(/** @type {string} */ query, /** @type {"next" | "previous"} */ direction) {
      state.query = query;
      return search(direction);
    },
    /** The query as the person types it: the match grows from where it is. */
    type(/** @type {string} */ query) {
      state.query = query;
      return search("next", true);
    },
    /** Change match case, regex or whole word; the next find uses them. */
    set(/** @type {Partial<Flags>} */ flags) {
      Object.assign(state.flags, flags);
    },
    close() {
      addon.clearDecorations();
      draw("");
    },
    state: () => ({ ...state, flags: { ...state.flags } }),
  };
}
