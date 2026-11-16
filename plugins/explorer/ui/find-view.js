// The find bar's DOM (#313): a search field that narrows the folder as the person types, a "Search
// below" toggle that walks the folders under it instead, and its results as a listbox, each with its
// folder and a button that shows it there. Enter opens a result, Shift+Enter reveals it, Escape stops
// a search and then closes the bar; arrows move between the field and the results.

/**
 * @typedef {import("./finding.js").FindModel} FindModel
 * @typedef {{ filter(query: string): unknown, below(query: string): unknown, stop(): unknown,
 *   close(): unknown, openFound(path: string): unknown, revealFound(path: string): unknown }} FindActions
 */

/** How long typing rests before a search below starts. */
const REST_MS = 300;

/** @param {Document} doc @param {FindActions} actions @param {() => void} back */
export function findView(doc, actions, back) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const bar = byId("find");
  const query = /** @type {HTMLInputElement} */ (byId("find-query"));
  const toggle = byId("find-below");
  const results = byId("results");
  /** @type {FindModel | null} */
  let model = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resting;

  const below = () => toggle.getAttribute("aria-pressed") === "true";
  const run = () => {
    clearTimeout(resting);
    if (below()) void actions.below(query.value);
    else void actions.filter(query.value);
  };
  query.addEventListener("input", () => {
    clearTimeout(resting);
    if (below()) resting = setTimeout(run, REST_MS);
    else run();
  });
  toggle.addEventListener("click", () => {
    toggle.setAttribute("aria-pressed", String(!below()));
    query.focus();
    run();
  });
  byId("find-close").addEventListener("click", () => actions.close());
  bar.addEventListener("submit", (event) => event.preventDefault());

  const options = () => [...results.querySelectorAll("[role=option]")];
  const focusOption = (/** @type {number} */ index) => {
    const list = options();
    const item = list[Math.max(0, Math.min(index, list.length - 1))];
    if (item instanceof HTMLElement) item.focus();
  };
  bar.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(resting);
      if (model?.busy) void actions.stop();
      else {
        void actions.close();
        back();
      }
    } else if (event.key === "Enter" && event.target === query) {
      event.preventDefault();
      run();
    } else if (event.key === "ArrowDown" && event.target === query && options().length > 0) {
      event.preventDefault();
      focusOption(0);
    }
  });
  results.addEventListener("keydown", (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest("[role=option]");
    if (!(item instanceof HTMLElement) || !item.dataset.path) return;
    const at = options().indexOf(item);
    if (event.key === "Enter") {
      event.preventDefault();
      void (event.shiftKey ? actions.revealFound : actions.openFound)(item.dataset.path);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(at + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (at === 0) query.focus();
      else focusOption(at - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      query.focus();
    }
  });
  results.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest("[role=option]");
    if (!(item instanceof HTMLElement) || !item.dataset.path) return;
    if (target.closest("button")) void actions.revealFound(item.dataset.path);
    else void actions.openFound(item.dataset.path);
  });

  const option = (/** @type {import("./find.js").Found} */ found) => {
    const item = doc.createElement("li");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.tabIndex = -1;
    item.dataset.path = found.path;
    item.className = "found";
    const name = doc.createElement("span");
    name.className = "name";
    name.textContent = found.name;
    const folder = doc.createElement("span");
    folder.className = "folder";
    folder.textContent = found.folder;
    const reveal = doc.createElement("button");
    reveal.type = "button";
    reveal.className = "desk-icon-btn";
    reveal.tabIndex = -1;
    reveal.setAttribute("aria-label", `Show ${found.name} in its folder`);
    reveal.title = "Show in its folder (Shift+Enter)";
    reveal.textContent = "↗";
    item.append(name, folder, reveal);
    item.addEventListener("focus", () => item.setAttribute("aria-selected", "true"));
    item.addEventListener("blur", () => item.setAttribute("aria-selected", "false"));
    return item;
  };

  return {
    /** Show the bar for `next`, or hide it; it takes the focus when it opens. */
    render(/** @type {FindModel | null} */ next) {
      const opening = model === null && next !== null;
      model = next;
      bar.hidden = next === null;
      if (next === null) {
        clearTimeout(resting);
        query.value = "";
        toggle.setAttribute("aria-pressed", "false");
        results.hidden = true;
        results.replaceChildren();
        return;
      }
      if (query.value !== next.query) query.value = next.query;
      toggle.setAttribute("aria-pressed", String(next.below));
      results.hidden = !next.below;
      results.setAttribute("aria-busy", String(next.busy === true));
      results.replaceChildren(...(next.results ?? []).map(option));
      if (opening) query.focus();
    },
  };
}
