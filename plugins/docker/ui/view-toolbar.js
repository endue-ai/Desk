// The toolbar over a list: a search field, the state chips, the sort and its direction, how many
// rows show; and under it, while rows are marked, how many and what can be done to all of them.

import { el } from "./dom.js";
import { CHIPS, chipOf, SORTS, withChip } from "./query.js";

/**
 * @typedef {import("./query.js").Prefs} Prefs
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const SORT_TITLES = /** @type {Record<string, string>} */ ({
  name: "Name",
  state: "State",
  cpu: "CPU",
  memory: "Memory",
  uptime: "Uptime",
  image: "Image",
  size: "Size",
  created: "Created",
  used: "Used by",
});

/** What the marks bar offers on each list: label, action, variant. */
const BULK = /** @type {Record<string, Array<[string, string, string]>>} */ ({
  containers: [
    ["Start", "start", ""],
    ["Stop", "stop", ""],
    ["Restart", "restart", ""],
    ["Pause", "togglePause", ""],
    ["Remove", "remove", "danger"],
  ],
  compose: [
    ["Start", "start", ""],
    ["Stop", "stop", ""],
    ["Restart", "restart", ""],
    ["Remove", "remove", "danger"],
  ],
  images: [["Remove", "removeImage", "danger"]],
  volumes: [["Remove", "removeVolume", "danger"]],
  networks: [["Remove", "removeNetwork", "danger"]],
});

const PLACEHOLDERS = /** @type {Record<string, string>} */ ({
  containers: "Search: words, is:running, project:shop, image:postgres, port:8080",
  compose: "Search the projects",
  images: "Search: words, is:dangling, is:unused, repo:…, tag:…",
  volumes: "Search: words, is:anonymous, project:…",
  networks: "Search: words, driver:bridge, project:…",
});

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createToolbar(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const form = byId("toolbar");
  const search = /** @type {HTMLInputElement} */ (byId("search"));
  const chips = byId("chips");
  const sort = /** @type {HTMLSelectElement} */ (byId("sort"));
  const dir = byId("sort-dir");
  const count = byId("count");
  const marks = byId("marks");
  const marksCount = byId("marks-count");
  const marksActions = byId("marks-actions");
  let list = "";
  /** @type {Prefs} */
  let prefs = { query: "", sort: { key: "name", desc: false } };

  form.addEventListener("submit", (event) => event.preventDefault());
  search.addEventListener("input", () => void act("query", search.value));
  sort.addEventListener("change", () => void act("sort", sort.value, prefs.sort.desc));
  dir.addEventListener("click", () => void act("sort", prefs.sort.key, !prefs.sort.desc));
  chips.addEventListener("click", (event) => {
    const chip = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[data-term]");
    if (chip)
      void act(
        "query",
        withChip(prefs.query, /** @type {HTMLElement} */ (chip).dataset.term ?? ""),
      );
  });

  return {
    search,
    /** Show the toolbar of `name` with its prefs, or hide it (the overview has none). */
    show(/** @type {string} */ name, /** @type {Prefs | undefined} */ next) {
      const has = name in SORTS;
      form.hidden = !has;
      if (!has) {
        marks.hidden = true;
        list = name;
        return;
      }
      const switched = name !== list;
      list = name;
      if (next) prefs = next;
      if (search.value !== prefs.query && doc.activeElement !== search) search.value = prefs.query;
      else if (switched) search.value = prefs.query;
      search.placeholder = PLACEHOLDERS[name] ?? "Search";
      const chosen = chipOf(prefs.query);
      // A chip that had the focus is drawn anew: the focus goes to the chip now chosen.
      const focused = chips.contains(doc.activeElement);
      chips.hidden = !CHIPS[name];
      chips.replaceChildren(
        ...(CHIPS[name] ?? []).map((chip) =>
          el(
            doc,
            "button",
            {
              type: "button",
              class: "desk-tab",
              "data-term": chip.term,
              "aria-pressed": chip.term === chosen ? "true" : "false",
            },
            chip.label,
          ),
        ),
      );
      if (focused)
        /** @type {HTMLElement | undefined} */ (
          chips.querySelectorAll('[aria-pressed="true"]')[0]
        )?.focus();
      const keys = SORTS[name] ?? [];
      sort.replaceChildren(
        ...keys.map((key) => el(doc, "option", { value: key }, SORT_TITLES[key] ?? key)),
      );
      sort.value = prefs.sort.key;
      sort.disabled = keys.length < 2;
      dir.textContent = prefs.sort.desc ? "↓" : "↑";
      dir.setAttribute(
        "aria-label",
        prefs.sort.desc ? "Sorted high to low; reverse (Z)" : "Sorted low to high; reverse (Z)",
      );
    },
    /** How many rows show of how many. */
    counted(/** @type {number} */ shown, /** @type {number} */ total) {
      count.textContent = total === 0 ? "" : shown === total ? `${total}` : `${shown} of ${total}`;
    },
    /** The marks bar: how many are marked and what can be done to all of them. */
    marked(/** @type {number} */ n) {
      marks.hidden = n === 0 || !BULK[list];
      if (marks.hidden) return;
      marksCount.textContent = `${n} marked`;
      marksActions.replaceChildren(
        ...(BULK[list] ?? []).map(([label, action, variant]) =>
          el(
            doc,
            "button",
            {
              type: "button",
              class: `desk-btn desk-btn-${variant || "quiet"}`,
              "data-act": action,
            },
            label,
          ),
        ),
      );
    },
  };
}
