// Find in the result (Mod+F in the grid): a bar over the grid with the text, the match count ("2 of
// 7"), previous and next, and two toggles (match case, whole cell). Typing goes to the first match
// at or after the cursor; Enter and Shift+Enter (F3 and Shift+F3) go to the next and previous one,
// wrapping; Escape closes the bar and gives the grid its focus back. The cells on screen that match
// are marked. Where the text is comes from the grid (rows-client.js), in the frame or its worker.

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { nextMatch } from "./rows.js";

/**
 * @typedef {{ matches: Int32Array, count: number }} Found
 * @typedef {{ needle: string, matchCase: boolean, whole: boolean }} Query
 * @typedef {{
 *   search(query: Query): Found | Promise<Found>,
 *   cursor(): { row: number, col: number },
 *   go(row: number, col: number): void,
 *   focus(): void,
 *   drawn(): void,
 * }} FinderActs
 *   `search` the screen cells holding the text; `go` moves the cursor there; `drawn` repaints the
 *   marks.
 */

/**
 * @param {Document} doc
 * @param {FinderActs} acts
 */
export function createFinder(doc, acts) {
  const input = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      type: "search",
      class: "desk-field",
      placeholder: t("grid.finder.findInTheResult"),
      spellcheck: "false",
      "aria-label": t("grid.finder.findInTheResult"),
    })
  );
  const count = el(doc, "span", { class: "find-count", role: "status" });
  const button = (/** @type {string} */ name, /** @type {string} */ label, text = label) =>
    el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-quiet", "data-find": name, title: label },
      text,
    );
  const toggle = (
    /** @type {string} */ name,
    /** @type {string} */ label,
    /** @type {string} */ text,
  ) =>
    el(
      doc,
      "button",
      {
        type: "button",
        class: "desk-chip",
        "data-find": name,
        "aria-pressed": "false",
        title: label,
      },
      text,
    );
  const matchCase = toggle("case", "Match case", "Aa");
  const whole = toggle("whole", "Match the whole cell", "Whole cell");
  const bar = el(
    doc,
    "div",
    {
      class: "grid-find",
      role: "search",
      "aria-label": t("grid.finder.findInTheResult"),
      hidden: "",
    },
    input,
    count,
    button("previous", "Previous match (Shift+Enter)", "Previous"),
    button("next", "Next match (Enter)", "Next"),
    matchCase,
    whole,
    button("close", "Close (Escape)", "Close"),
  );
  /** @type {Found} */
  let found = { matches: new Int32Array(0), count: 0 };
  let asked = 0;
  const query = () => ({
    needle: input.value,
    matchCase: matchCase.getAttribute("aria-pressed") === "true",
    whole: whole.getAttribute("aria-pressed") === "true",
  });

  /** "2 of 7" when the cursor is on a match, else how many there are. */
  const say = () => {
    const at = acts.cursor();
    const n = found.matches.length / 2;
    let index = -1;
    for (let i = 0; i < n && index < 0; i++)
      if (found.matches[2 * i] === at.row && found.matches[2 * i + 1] === at.col) index = i;
    count.textContent = !input.value
      ? ""
      : found.count === 0
        ? t("grid.finder.noMatch")
        : index >= 0
          ? t("grid.finder.of", { value: String(index + 1), count: String(found.count) })
          : t("grid.finder.match", {
              count: String(found.count),
              value: String(found.count === 1 ? "" : t("grid.finder.es")),
            });
  };

  /** Go to a match: the first at or after the cursor (0), the next (1) or the previous (-1). */
  const step = (/** @type {-1 | 0 | 1} */ by) => {
    const i = nextMatch(found.matches, acts.cursor(), by);
    if (i >= 0) acts.go(found.matches[2 * i] ?? 0, found.matches[2 * i + 1] ?? 0);
    say();
  };

  /** Search again (the text, an option, the rows or the columns changed), then `then`. */
  const refresh = (/** @type {(() => void) | undefined} */ then = undefined) => {
    const id = ++asked;
    const got = acts.search(query());
    const done = (/** @type {Found} */ next) => {
      if (id !== asked) return;
      found = next;
      acts.drawn();
      if (then) then();
      else say();
    };
    if (got instanceof Promise) void got.then(done, () => {});
    else done(got);
  };

  const close = () => {
    bar.hidden = true;
    found = { matches: new Int32Array(0), count: 0 };
    asked++;
    acts.drawn();
    acts.focus();
  };

  input.addEventListener("input", () => refresh(() => step(0)));
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" || event.key === "F3") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    event.stopPropagation();
  });
  bar.addEventListener("click", (event) => {
    const name = /** @type {HTMLElement} */ (event.target)
      .closest("[data-find]")
      ?.getAttribute("data-find");
    if (name === "next") step(1);
    else if (name === "previous") step(-1);
    else if (name === "close") close();
    else if (name === "case" || name === "whole") {
      const chip = name === "case" ? matchCase : whole;
      chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
      refresh();
      input.focus();
    }
  });

  return {
    el: bar,
    /** Open the bar (with `text`, when given) and put the caret in it. */
    open(/** @type {string | undefined} */ text) {
      bar.hidden = false;
      if (text !== undefined) input.value = text;
      input.focus();
      input.select();
      if (input.value) refresh(() => step(0));
    },
    close,
    /** The next or previous match, opening the bar when it is closed. */
    step(/** @type {1 | -1} */ by) {
      if (bar.hidden || !input.value) return this.open(undefined);
      step(by);
    },
    /** The rows or columns on screen changed: search again, the cursor staying where it is. */
    changed() {
      if (!bar.hidden && input.value) refresh();
    },
    /** Whether a cell's value is a match, for its mark. */
    marks(/** @type {string | null} */ value) {
      const { needle, matchCase: exact, whole: all } = query();
      if (bar.hidden || !needle || found.count === 0) return false;
      const text = value === null ? t("grid.finder.null") : value;
      const [a, b] = exact ? [text, needle] : [text.toLowerCase(), needle.toLowerCase()];
      return all ? a === b : a.includes(b);
    },
    say,
  };
}
