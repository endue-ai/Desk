// A query plan as a table (PG-70): a row per node, the ones that take most of the whole first, with
// its estimated against actual rows, its loops, its own and total time (or cost), its share, its
// buffers and its marks. A column's header sorts by it.

import { el } from "./dom.js";
import { flatten } from "./explain/plan.js";
import { buffersText, costText, count, ms } from "./explain/words.js";
import { t } from "./strings/index.js";
import { marksView } from "./view-plan-marks.js";

/** @typedef {import("./explain/plan.js").PlanNode} PlanNode */

/**
 * @typedef {{ name: string, value(n: PlanNode): number | null, text(n: PlanNode): string }} Column
 */

const num = (/** @type {number | null} */ n, /** @type {(n: number) => string} */ f) =>
  n === null ? "" : f(n);

/** @param {Document} doc @param {PlanNode} root */
export function tableView(doc, root) {
  const timed = root.time !== null;
  /** @type {Column[]} */
  const columns = [
    { name: "plan.columnEstRows", value: (n) => n.rows, text: (n) => num(n.rows, count) },
    { name: "plan.columnRows", value: (n) => n.actualRows, text: (n) => num(n.actualRows, count) },
    {
      name: "plan.columnMisestimate",
      value: (n) => (n.misestimate === null ? null : Math.max(n.misestimate, 1 / n.misestimate)),
      text: (n) => {
        if (n.misestimate === null) return "";
        const ratio = Math.max(n.misestimate, 1 / n.misestimate);
        // Within half again of the estimate is no miss worth a word.
        if (ratio < 1.5) return "×1";
        return t(n.misestimate >= 1 ? "plan.misestimateMore" : "plan.misestimateFewer", {
          ratio: count(ratio),
        });
      },
    },
    { name: "plan.columnLoops", value: (n) => n.loops, text: (n) => num(n.loops, count) },
    timed
      ? { name: "plan.columnOwn", value: (n) => n.ownTime, text: (n) => num(n.ownTime, ms) }
      : { name: "plan.columnOwnCost", value: (n) => n.self, text: (n) => costText(n.self) },
    timed
      ? { name: "plan.columnTotal", value: (n) => n.time, text: (n) => num(n.time, ms) }
      : { name: "plan.columnCost", value: (n) => n.cost, text: (n) => num(n.cost, costText) },
    {
      name: "plan.columnShare",
      value: (n) => n.share,
      text: (n) => `${Math.round(n.share * 100)}%`,
    },
  ];
  const nodes = flatten(root).map(({ node }) => node);
  let by = columns.findIndex((c) => c.name === "plan.columnShare");
  const body = el(doc, "tbody");
  const draw = () => {
    const column = columns[by];
    const sorted = column
      ? [...nodes].sort((a, b) => (column.value(b) ?? -1) - (column.value(a) ?? -1))
      : nodes;
    body.replaceChildren(
      ...sorted.map((n) =>
        el(
          doc,
          "tr",
          { class: n.hot ? `hot-${n.hot}` : undefined },
          el(doc, "th", { scope: "row", class: "plan-label" }, n.label),
          ...columns.map((c) => el(doc, "td", { class: "num" }, c.text(n))),
          el(doc, "td", { class: "wrap" }, marksView(doc, n)),
          el(doc, "td", { class: "wrap" }, buffersText(n.buffers)),
        ),
      ),
    );
    for (const [i, th] of heads.entries())
      th.setAttribute("aria-sort", i === by ? "descending" : "none");
  };
  const heads = columns.map((c, i) => {
    const th = el(doc, "th", { scope: "col", class: "num" });
    const sort = el(
      doc,
      "button",
      {
        type: "button",
        class: "desk-btn desk-btn-quiet",
        title: t("plan.sortBy", { column: t(c.name).toLowerCase() }),
      },
      t(c.name),
    );
    sort.addEventListener("click", () => {
      by = i;
      draw();
    });
    th.append(sort);
    return th;
  });
  const head = el(
    doc,
    "tr",
    {},
    el(doc, "th", { scope: "col" }, t("plan.columnNode")),
    ...heads,
    el(doc, "th", { scope: "col" }, t("plan.columnMarks")),
    el(doc, "th", { scope: "col" }, t("plan.columnBuffers")),
  );
  draw();
  return el(
    doc,
    "div",
    {
      class: "plan-table-box",
      tabindex: "0",
      role: "region",
      "aria-label": t("plan.tableLabel"),
    },
    el(doc, "table", { class: "desk-table plan-table" }, el(doc, "thead", {}, head), body),
  );
}
