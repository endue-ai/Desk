// A query plan as a table (PG-70): a row per node, the ones that take most of the whole first, with
// its estimated against actual rows, its loops, its own and total time (or cost), its share, its
// buffers and its marks. A column's header sorts by it.

import { el } from "./dom.js";
import { flatten } from "./explain/plan.js";
import { buffersText, costText, count, ms } from "./explain/words.js";
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
    { name: "Est. rows", value: (n) => n.rows, text: (n) => num(n.rows, count) },
    { name: "Rows", value: (n) => n.actualRows, text: (n) => num(n.actualRows, count) },
    {
      name: "Misestimate",
      value: (n) => (n.misestimate === null ? null : Math.max(n.misestimate, 1 / n.misestimate)),
      text: (n) =>
        n.misestimate === null
          ? ""
          : n.misestimate >= 1
            ? `×${count(n.misestimate)} more`
            : `×${count(1 / n.misestimate)} fewer`,
    },
    { name: "Loops", value: (n) => n.loops, text: (n) => num(n.loops, count) },
    timed
      ? { name: "Own", value: (n) => n.ownTime, text: (n) => num(n.ownTime, ms) }
      : { name: "Own cost", value: (n) => n.self, text: (n) => costText(n.self) },
    timed
      ? { name: "Total", value: (n) => n.time, text: (n) => num(n.time, ms) }
      : { name: "Cost", value: (n) => n.cost, text: (n) => num(n.cost, costText) },
    { name: "Share", value: (n) => n.share, text: (n) => `${Math.round(n.share * 100)}%` },
  ];
  const nodes = flatten(root).map(({ node }) => node);
  let by = columns.findIndex((c) => c.name === "Share");
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
          el(doc, "td", {}, buffersText(n.buffers)),
          el(doc, "td", {}, marksView(doc, n)),
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
        title: `Sort by ${c.name.toLowerCase()}, largest first`,
      },
      c.name,
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
    el(doc, "th", { scope: "col" }, "Node"),
    ...heads,
    el(doc, "th", { scope: "col" }, "Buffers"),
    el(doc, "th", { scope: "col" }, "Marks"),
  );
  draw();
  return el(
    doc,
    "div",
    {
      class: "plan-table-box",
      tabindex: "0",
      role: "region",
      "aria-label": "The plan's nodes, as a table",
    },
    el(doc, "table", { class: "desk-table plan-table" }, el(doc, "thead", {}, head), body),
  );
}
