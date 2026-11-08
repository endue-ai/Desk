// The search bar over the terminal on screen (TERM-E08): the query, match case, regular expression
// and whole word, previous and next, and which match of how many. Enter finds the next one,
// Shift+Enter the one before, Escape closes the bar and goes back into the terminal.

/**
 * @typedef {ReturnType<typeof import("./search.js").createSearch>} Search
 * @typedef {import("./search.js").Flags} Flags
 */

const FLAGS = /** @type {const} */ ([
  ["caseSensitive", "Aa", "Match case"],
  ["regex", ".*", "Regular expression"],
  ["wholeWord", "W", "Whole word"],
]);

/**
 * @param {Document} doc
 * @param {HTMLElement} bar the page's #search element
 * @param {{ search(): Search | undefined, back(): void }} deps
 */
export function createSearchBar(doc, bar, deps) {
  const input = doc.createElement("input");
  input.type = "search";
  input.className = "desk-field search-query";
  input.placeholder = "Find";
  input.setAttribute("aria-label", "Find in the terminal");
  const count = doc.createElement("span");
  count.className = "search-count";
  count.setAttribute("role", "status");
  /** @type {Flags} */
  const flags = { caseSensitive: false, regex: false, wholeWord: false };
  const button = (/** @type {string} */ text, /** @type {string} */ name) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "desk-icon-btn";
    b.textContent = text;
    b.title = name;
    b.setAttribute("aria-label", name);
    return b;
  };
  const toggles = FLAGS.map(([flag, text, name]) => {
    const b = button(text, name);
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      flags[flag] = !flags[flag];
      b.setAttribute("aria-pressed", String(flags[flag]));
      deps.search()?.set(flags);
      deps.search()?.type(input.value);
      input.focus();
    });
    return b;
  });
  const previous = button("↑", "Previous match");
  const next = button("↓", "Next match");
  const close = button("×", "Close the search");
  previous.addEventListener("click", () => deps.search()?.find(input.value, "previous"));
  next.addEventListener("click", () => deps.search()?.find(input.value, "next"));
  close.addEventListener("click", () => hide());
  bar.append(input, ...toggles, count, previous, next, close);

  input.addEventListener("input", () => deps.search()?.type(input.value));
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      deps.search()?.find(input.value, event.shiftKey ? "previous" : "next");
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  });

  const hide = () => {
    if (bar.hidden) return;
    bar.hidden = true;
    deps.search()?.close();
    count.textContent = "";
    deps.back();
  };

  return {
    /** Open the bar on the terminal on screen, with `selection` as the query when there is one. */
    show(/** @type {string} */ selection = "") {
      bar.hidden = false;
      if (selection && !selection.includes("\n")) input.value = selection;
      deps.search()?.set(flags);
      input.focus();
      input.select();
      if (input.value) deps.search()?.type(input.value);
    },
    hide,
    /** What the search on screen says: which match of how many, or why it cannot search. */
    render(/** @type {string} */ label) {
      count.textContent = label;
    },
    /** Another terminal came on screen: the open bar searches that one. */
    switched(/** @type {Search | undefined} */ before) {
      if (bar.hidden) return;
      before?.close();
      deps.search()?.set(flags);
      if (input.value) deps.search()?.type(input.value);
    },
    open: () => !bar.hidden,
  };
}
