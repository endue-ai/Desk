// A query plan as a flame (an icicle, PG-70): a row per depth, each node a block inside its parent
// as wide as its total time (its cost when the statement did not run), coloured by its own share
// of the whole, labelled with its own time; every block names itself for a screen reader and in
// its tooltip. Layout: explain/flame.js.

import { el } from "./dom.js";
import { flameOf } from "./explain/flame.js";
import { costText, ms } from "./explain/words.js";
import { t } from "./strings/index.js";

/** @typedef {import("./explain/plan.js").PlanNode} PlanNode */

/** @param {Document} doc @param {PlanNode} root */
export function flameView(doc, root) {
  const { measure, blocks, depth } = flameOf(root);
  if (!blocks.length) return el(doc, "p", { class: "empty" }, t("plan.flameEmpty"));
  const value = (/** @type {number | null} */ n) =>
    n === null ? "?" : measure === "time" ? ms(n) : t("plan.cost", { cost: costText(n) });
  const rows = Array.from({ length: depth }, () => el(doc, "div", { class: "flame-row" }));
  for (const { node, x, w, depth: at } of blocks) {
    const own = measure === "time" ? node.ownTime : node.self;
    const share = Math.round(node.share * 100);
    const said = t("plan.flameSaid", {
      label: node.label,
      own: value(own),
      total: value(node[measure]),
      share,
    });
    rows[at]?.append(
      el(
        doc,
        "div",
        {
          class: `flame-block${node.hot ? ` hot-${node.hot}` : ""}`,
          style: `left: ${(x * 100).toFixed(3)}%; width: ${(w * 100).toFixed(3)}%`,
          role: "img",
          "aria-label": said,
          title: said,
        },
        el(doc, "span", { class: "flame-text" }, `${node.label} · ${value(own)}`),
      ),
    );
  }
  const what = t(measure === "time" ? "plan.measureTime" : "plan.measureCost");
  return el(
    doc,
    "div",
    { class: "flame", role: "group", "aria-label": t("plan.flameLabel", { what }) },
    el(doc, "p", { class: "flame-note" }, t("plan.flameNote", { what })),
    ...rows,
  );
}
