// A query plan as a flame (an icicle, PG-70): a row per depth, each node a block inside its parent
// as wide as its total time (its cost when the statement did not run), coloured by its own share
// of the whole, labelled with its own time; every block names itself for a screen reader and in
// its tooltip. Layout: explain/flame.js.

import { el } from "./dom.js";
import { flameOf } from "./explain/flame.js";
import { costText, ms } from "./explain/words.js";

/** @typedef {import("./explain/plan.js").PlanNode} PlanNode */

/** @param {Document} doc @param {PlanNode} root */
export function flameView(doc, root) {
  const { measure, blocks, depth } = flameOf(root);
  if (!blocks.length)
    return el(doc, "p", { class: "empty" }, "This plan has no cost or time to draw.");
  const value = (/** @type {number | null} */ n) =>
    n === null ? "?" : measure === "time" ? ms(n) : `cost ${costText(n)}`;
  const rows = Array.from({ length: depth }, () => el(doc, "div", { class: "flame-row" }));
  for (const { node, x, w, depth: at } of blocks) {
    const own = measure === "time" ? node.ownTime : node.self;
    const share = Math.round(node.share * 100);
    const said = `${node.label}: ${value(own)} own of ${value(node[measure])}, ${share}% of the whole`;
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
  const what = measure === "time" ? "time" : "estimated cost";
  return el(
    doc,
    "div",
    { class: "flame", role: "group", "aria-label": `Where the plan's ${what} goes` },
    el(
      doc,
      "p",
      { class: "flame-note" },
      `Each block is as wide as its ${what}, its own part coloured: half or more of the whole, a fifth or more, less.`,
    ),
    ...rows,
  );
}
