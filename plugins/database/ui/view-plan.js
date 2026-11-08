// A query plan's DOM (item 6): the plan tree as an outline (role=tree), each node with its
// estimated cost and rows, the time and rows it took when the statement ran, and a bar for its own
// share of the whole; the nodes where half or a fifth of it goes are marked, with words as well as
// colour.

import { el } from "./dom.js";
import { flatten } from "./explain/plan.js";
import { formatCount } from "./format.js";

/** @typedef {import("./explain/plan.js").PlanNode} PlanNode */

const round = (/** @type {number} */ n) => (n >= 100 ? formatCount(Math.round(n)) : n.toFixed(2));

/**
 * @param {Document} doc
 * @param {PlanNode} root
 */
export function planView(doc, root) {
  const rows = flatten(root).map(({ node, depth }, i) => {
    const facts = [
      node.cost !== null ? `cost ${round(node.cost)}` : "",
      node.rows !== null ? `${formatCount(node.rows)} rows est.` : "",
      node.actualRows !== null ? `${formatCount(node.actualRows)} rows` : "",
      node.time !== null ? `${round(node.time)} ms` : "",
    ].filter(Boolean);
    const hot =
      node.hot === "high" ? "most of the time" : node.hot === "medium" ? "a large part" : "";
    const share = Math.round(node.share * 100);
    return el(
      doc,
      "li",
      {
        role: "treeitem",
        "aria-level": String(depth + 1),
        class: `plan-node${node.hot ? ` hot-${node.hot}` : ""}`,
        tabindex: i === 0 ? "0" : "-1",
        style: `padding-left: ${depth * 18 + 8}px`,
      },
      el(doc, "span", { class: "plan-label" }, node.label),
      hot ? el(doc, "span", { class: "plan-hot" }, hot) : undefined,
      el(doc, "span", { class: "plan-facts" }, facts.join(" · ")),
      el(
        doc,
        "span",
        {
          class: "plan-share",
          title: `${share}% of the whole is this node's own`,
          "aria-label": `${share}% own share`,
        },
        el(doc, "span", { class: "plan-bar", style: `width: ${Math.min(100, share)}%` }),
      ),
      node.detail ? el(doc, "span", { class: "plan-detail" }, node.detail) : undefined,
    );
  });
  const tree = el(doc, "ul", { class: "plan", role: "tree", "aria-label": "Query plan" }, ...rows);
  tree.addEventListener("keydown", (event) => {
    const items = [...tree.querySelectorAll("[role=treeitem]")];
    const at = items.indexOf(/** @type {Element} */ (doc.activeElement));
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -items.length, End: items.length }[event.key];
    if (step === undefined || at < 0) return;
    event.preventDefault();
    const next = /** @type {HTMLElement | undefined} */ (
      items[Math.max(0, Math.min(items.length - 1, at + step))]
    );
    next?.focus();
  });
  return tree;
}
