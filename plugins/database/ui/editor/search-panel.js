// The console editor's find and replace bar, on the design system's controls: what to find, match
// case, whole word, regular expression, what to replace it with, and the count of matches. Enter
// finds the next match and Shift+Enter the one before; in the replace field Enter replaces the next
// and Mod+Enter all; Escape, anywhere in the bar, closes it and gives the editor its focus back.

import { el } from "../dom.js";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  runScopeHandlers,
  SearchQuery,
  search,
  setSearchQuery,
} from "../vendor/editor-component.mjs";

/** @typedef {import("../vendor/editor-component.mjs").EditorView} View */

/** Matches counted for the bar, at most, and how long after a change. */
const COUNTED = 10000;
const COUNT_DELAY = 150;

/** How many matches the query has, up to COUNTED; null when it is not valid. */
export function countMatches(/** @type {View} */ view, /** @type {SearchQuery} */ query) {
  if (!query.search || !query.valid) return null;
  const cursor = query.getCursor(view.state.doc);
  let n = 0;
  while (n < COUNTED && !cursor.next().done) n++;
  return n;
}

/** @param {View} view */
function createPanel(view) {
  const doc = view.dom.ownerDocument;
  const field = (/** @type {string} */ name, /** @type {string} */ label) =>
    /** @type {HTMLInputElement} */ (
      el(doc, "input", {
        class: "desk-field",
        name,
        placeholder: label,
        "aria-label": label,
        spellcheck: "false",
        autocomplete: "off",
      })
    );
  const check = (/** @type {string} */ name, /** @type {string} */ label) => {
    const box = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name })
    );
    return { box, label: el(doc, "label", { class: "check" }, box, ` ${label}`) };
  };
  const button = (
    /** @type {string} */ name,
    /** @type {string} */ label,
    /** @type {string} */ kind,
    title = label,
  ) =>
    /** @type {HTMLButtonElement} */ (
      el(
        doc,
        "button",
        { type: "button", class: kind, name, title, "aria-label": label },
        kind === "desk-icon-btn" ? (name === "close" ? "×" : name === "prev" ? "‹" : "›") : label,
      )
    );

  const find = field("search", "Find");
  find.setAttribute("main-field", "true");
  const replace = field("replace", "Replace");
  const caseBox = check("case", "Match case");
  const wordBox = check("word", "Whole word");
  const reBox = check("re", "Regular expression");
  const count = el(doc, "span", { class: "count", role: "status", "aria-live": "polite" });
  const prev = button("prev", "Previous match", "desk-icon-btn", "Previous match (Shift+Enter)");
  const next = button("next", "Next match", "desk-icon-btn", "Next match (Enter)");
  const one = button("replace", "Replace", "desk-btn desk-btn-quiet");
  const all = button("replaceAll", "Replace all", "desk-btn desk-btn-quiet");
  const close = button("close", "Close find", "desk-icon-btn", "Close find (Escape)");

  const read = () =>
    new SearchQuery({
      search: find.value,
      caseSensitive: caseBox.box.checked,
      wholeWord: wordBox.box.checked,
      regexp: reBox.box.checked,
      replace: replace.value,
    });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let counting;
  // Counted a moment after the last change, so typing in a long script never waits for it.
  const show = (/** @type {SearchQuery} */ query) => {
    clearTimeout(counting);
    counting = setTimeout(() => {
      const n = countMatches(view, query);
      const many = n === COUNTED ? `${COUNTED}+` : String(n);
      count.textContent =
        n === null
          ? query.search
            ? "Not a valid expression"
            : ""
          : `${many} match${n === 1 ? "" : "es"}`;
      find.setAttribute("aria-invalid", String(n === null && Boolean(query.search)));
    }, COUNT_DELAY);
  };
  const commit = () => {
    const query = read();
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
    show(query);
  };
  const run = (/** @type {(v: View) => boolean} */ command) => () => {
    commit();
    command(view);
    show(getSearchQuery(view.state));
  };

  for (const input of [find, replace]) input.addEventListener("input", commit);
  for (const box of [caseBox.box, wordBox.box, reBox.box]) box.addEventListener("change", commit);
  prev.addEventListener("click", run(findPrevious));
  next.addEventListener("click", run(findNext));
  one.addEventListener("click", run(replaceNext));
  all.addEventListener("click", run(replaceAll));
  close.addEventListener("click", () => closeSearchPanel(view));
  find.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    run(event.shiftKey ? findPrevious : findNext)();
  });
  replace.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    run(event.metaKey || event.ctrlKey ? replaceAll : replaceNext)();
  });

  const dom = el(
    doc,
    "div",
    { class: "find-bar", role: "search", "aria-label": "Find and replace" },
    el(doc, "div", { class: "row" }, find, prev, next, count, close),
    el(doc, "div", { class: "row" }, replace, one, all, caseBox.label, wordBox.label, reBox.label),
  );
  // The bar's keys (Escape, Mod+F, F3, Mod+G) from anywhere in it, as the editor's keymap names them.
  dom.addEventListener("keydown", (event) => {
    if (!event.defaultPrevented && runScopeHandlers(view, event, "search-panel"))
      event.preventDefault();
  });
  const sync = (/** @type {SearchQuery} */ query) => {
    find.value = query.search;
    replace.value = query.replace;
    caseBox.box.checked = query.caseSensitive;
    wordBox.box.checked = query.wholeWord;
    reBox.box.checked = query.regexp;
    show(query);
  };
  sync(getSearchQuery(view.state));
  return {
    dom,
    top: true,
    mount: () => find.select(),
    /** @param {import("../vendor/editor-component.mjs").ViewUpdate} update */
    update(update) {
      for (const tr of update.transactions)
        for (const effect of tr.effects)
          if (effect.is(setSearchQuery) && !effect.value.eq(read())) sync(effect.value);
      if (update.docChanged) show(getSearchQuery(update.state));
    },
    destroy: () => clearTimeout(counting),
  };
}

/** The find and replace extension. */
export const findAndReplace = () => search({ top: true, createPanel });
