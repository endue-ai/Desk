// Two results compared (PG-26, ADR 0329), the compare panel's module: which two results (before and
// after, each with its console), what their rows were paired by and why, the counts, the columns
// only one side has, and a row per difference kept: added, removed, or changed with each changed
// cell showing its value before and after, in words for a screen reader too. Copy and Export write
// the difference in the plugin's formats.

import { el } from "../../dom.js";
import { cellText } from "../../grid-model.js";

/**
 * @typedef {import("../../compare/diff.js").Difference} Difference
 * @typedef {import("./keys.js").Why} Why
 * @typedef {{ label: string, console: string, sql: string, truncated: boolean }} Side
 * @typedef {Difference & { before: Side, after: Side, why: Why, summary: string, dialect?: import("../../sql/lexer.js").Dialect }} CompareState
 */

const n = (/** @type {number} */ count) => count.toLocaleString("en-US");
const CHANGE_WORD = { added: "Added", removed: "Removed", changed: "Changed" };

/** What the rows were paired by, in words. */
function keyed(/** @type {Difference} */ d, /** @type {Why} */ why) {
  if (why === "primary") return `the primary key (${d.key.join(", ")})`;
  if (why === "picked") return d.key.join(", ");
  if (why === "position") return "row position";
  return "row position, as the results do not both carry a primary key";
}

/** The comparison in one sentence, as the panel and the status line say it. */
export function summaryOf(/** @type {Difference} */ d, /** @type {Why} */ why) {
  const { added, removed, changed, same } = d.counts;
  const counts =
    d.total === 0
      ? `no difference, ${n(same)} row${same === 1 ? "" : "s"} the same`
      : `${n(changed)} changed, ${n(added)} added, ${n(removed)} removed, ${n(same)} the same`;
  return `Compared by ${keyed(d, why)}: ${counts}.`;
}

/** The panel's state: the difference, the two results, and what is said of them. */
export function stateOf(
  /** @type {{ before: Side, after: Side }} */ sides,
  /** @type {Difference} */ d,
  /** @type {Why} */ why,
) {
  /** @type {CompareState} */
  const state = { ...d, ...sides, why, summary: summaryOf(d, why) };
  return state;
}

/** A cell of a difference's row: its value, or both values when it changed. */
function cell(
  /** @type {Document} */ doc,
  /** @type {import("../../compare/diff.js").DiffRow} */ row,
  /** @type {number} */ c,
  /** @type {string} */ name,
) {
  const value = (/** @type {(string | null)[] | null} */ side) => side?.[c] ?? null;
  if (!row.cells.includes(c)) {
    const shown = value(row.after ?? row.before);
    return el(doc, "td", { class: shown === null ? "null" : undefined }, cellText(shown));
  }
  const was = cellText(value(row.before));
  const now = cellText(value(row.after));
  return el(
    doc,
    "td",
    { class: "compare-cell", "aria-label": `${name}: ${was}, now ${now}` },
    el(doc, "del", {}, was),
    el(doc, "ins", {}, now),
  );
}

/** @param {Document} doc @param {CompareState} state @param {(action: string, ...args: unknown[]) => unknown} act */
export function comparePanel(doc, state, act) {
  const side = (/** @type {string} */ name, /** @type {Side} */ s) =>
    el(doc, "p", { title: s.sql }, `${name}: ${s.label} (${s.console})`);
  const only = [
    state.onlyBefore.length ? `Only before: ${state.onlyBefore.join(", ")}.` : "",
    state.onlyAfter.length ? `Only after: ${state.onlyAfter.join(", ")}.` : "",
  ].filter(Boolean);
  const cut = [state.before.truncated, state.after.truncated];
  const note = cut[0]
    ? cut[1]
      ? "Both results have more rows than they loaded: only the rows loaded are compared."
      : "The result before has more rows than it loaded: only the rows loaded are compared."
    : cut[1]
      ? "The result after has more rows than it loaded: only the rows loaded are compared."
      : "";
  const button = (
    /** @type {string} */ what,
    /** @type {string} */ label,
    /** @type {string} */ action,
  ) => {
    const b = el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-quiet", "data-compare": what },
      label,
    );
    b.addEventListener("click", () => act(action));
    return b;
  };
  const byPosition = state.by === "position";
  const head = ["Change", ...(byPosition ? ["Row"] : []), ...state.common].map((name) =>
    el(doc, "th", { scope: "col" }, name),
  );
  const body = state.rows.map((row) =>
    el(
      doc,
      "tr",
      { class: `compare-${row.change}` },
      el(doc, "td", { class: "compare-change" }, CHANGE_WORD[row.change]),
      ...(byPosition ? [el(doc, "td", {}, row.at)] : []),
      ...state.common.map((name, c) => cell(doc, row, c, name)),
    ),
  );
  return el(
    doc,
    "div",
    { class: "compare" },
    el(
      doc,
      "div",
      { class: "compare-head" },
      el(
        doc,
        "div",
        { class: "compare-sides" },
        side("Before", state.before),
        side("After", state.after),
      ),
      el(
        doc,
        "div",
        { class: "compare-actions" },
        button("copy", "Copy", "copyDifference"),
        button("export", "Export", "exportDifference"),
      ),
    ),
    el(doc, "p", { class: "compare-count", role: "status" }, state.summary),
    only.length
      ? el(doc, "p", { class: "compare-columns hint" }, `${only.join(" ")} Not compared.`)
      : undefined,
    state.repeated
      ? el(
          doc,
          "p",
          { class: "compare-repeated hint" },
          `${n(state.repeated)} row${state.repeated === 1 ? " repeats" : "s repeat"} a key: they are paired in order.`,
        )
      : undefined,
    note ? el(doc, "p", { class: "compare-note hint" }, note) : undefined,
    state.rows.length < state.total
      ? el(
          doc,
          "p",
          { class: "compare-kept hint" },
          `Listed: the first ${n(state.rows.length)} of ${n(state.total)} differences; copy and export hold the same.`,
        )
      : undefined,
    state.rows.length
      ? el(
          doc,
          "div",
          {
            class: "compare-scroll",
            tabindex: "0",
            role: "region",
            "aria-label": "The differences, row by row",
          },
          el(
            doc,
            "table",
            { class: "desk-table compare-table" },
            el(doc, "thead", {}, el(doc, "tr", {}, ...head)),
            el(doc, "tbody", {}, ...body),
          ),
        )
      : el(doc, "p", { class: "empty" }, "The two results hold the same rows."),
  );
}
