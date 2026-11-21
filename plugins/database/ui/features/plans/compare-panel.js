// Two plans compared (PG-70), the plans panel's module: what each plan is (when, which console, its
// statement, its time or cost) side by side over a table of their nodes paired down the tree
// (explain/compare.js), before on the left, after on the right, and what changed in the node: its
// kind, its cost, its time; a node only one plan has is added or gone. A changed row says so in
// words, and is marked.

import { el } from "../../dom.js";
import { costText, ms } from "../../explain/words.js";

/**
 * @typedef {import("../../explain/compare.js").Comparison} Comparison
 * @typedef {import("../../explain/compare.js").Brief} Brief
 * @typedef {{ label: string, console: string, sql: string, at: string, time: number | null, cost: number | null, planning: number | null, execution: number | null }} Side
 * @typedef {{ before: Side, after: Side, comparison: Comparison }} CompareState
 */

/** The node's cost and time in a few words. */
function facts(/** @type {Brief} */ b) {
  return [
    b.cost !== null ? `cost ${costText(b.cost)}` : "",
    b.time !== null ? ms(b.time) : "",
    b.actualRows !== null ? `${Math.round(b.actualRows).toLocaleString()} rows` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One plan's heading. */
function sideView(/** @type {Document} */ doc, /** @type {string} */ name, /** @type {Side} */ s) {
  const took = [
    s.execution !== null ? `execution ${ms(s.execution)}` : s.time !== null ? ms(s.time) : "",
    s.planning !== null ? `planning ${ms(s.planning)}` : "",
    s.cost !== null ? `cost ${costText(s.cost)}` : "",
  ].filter(Boolean);
  return el(
    doc,
    "section",
    { class: "plans-side", "aria-label": name },
    el(doc, "h3", {}, `${name}: ${s.label}, ${s.at}`),
    el(doc, "p", { class: "hint" }, `${s.console} · ${took.join(" · ")}`),
    el(doc, "code", { class: "plans-sql", title: s.sql }, s.sql),
  );
}

/** A node of one plan in its cell, indented by its depth. */
function cell(
  /** @type {Document} */ doc,
  /** @type {Brief | null} */ b,
  /** @type {number} */ depth,
) {
  if (!b) return el(doc, "td", { class: "plans-none" }, "not in this plan");
  return el(
    doc,
    "td",
    { style: `padding-left: ${depth * 14 + 8}px` },
    el(doc, "span", { class: "plan-label" }, b.label),
    el(doc, "span", { class: "plans-facts" }, facts(b)),
  );
}

/** @param {Document} doc @param {CompareState} state */
export function compareView(doc, state) {
  const { rows, changed } = state.comparison;
  const body = rows.map((row) =>
    el(
      doc,
      "tr",
      { class: row.changes.length ? "plans-changed" : undefined },
      cell(doc, row.before, row.depth),
      cell(doc, row.after, row.depth),
      el(doc, "td", { class: "plans-change" }, row.changes.join(" · ") || "same"),
    ),
  );
  return el(
    doc,
    "div",
    { class: "plans" },
    el(
      doc,
      "div",
      { class: "plans-head" },
      sideView(doc, "Before", state.before),
      sideView(doc, "After", state.after),
    ),
    el(
      doc,
      "p",
      { class: "plans-count", role: "status" },
      `${changed} of ${rows.length} nodes changed`,
    ),
    el(
      doc,
      "div",
      {
        class: "plans-scroll",
        tabindex: "0",
        role: "region",
        "aria-label": "The two plans, node by node",
      },
      el(
        doc,
        "table",
        { class: "desk-table plans-table" },
        el(
          doc,
          "thead",
          {},
          el(
            doc,
            "tr",
            {},
            el(doc, "th", { scope: "col" }, "Before"),
            el(doc, "th", { scope: "col" }, "After"),
            el(doc, "th", { scope: "col" }, "What changed"),
          ),
        ),
        el(doc, "tbody", {}, ...body),
      ),
    ),
  );
}
