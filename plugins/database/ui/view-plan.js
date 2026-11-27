// A query plan's DOM (item 6, PG-70): the statement's totals at the top (planning and execution
// time, buffers, WAL, triggers), a bar that shows the plan as a tree, a flame or a table and copies
// it as text or JSON, compares it with another or explains again with options, and the plan
// itself. The tree is an outline (role=tree): each node with its cost, its estimated against
// actual rows (loops multiplied out), its own and total time, its buffers, a bar for its own share
// of the whole and the marks that say why it is slow, in words as well as colour. The bar's
// buttons call the plans feature's actions (features/plans/).

import { el } from "./dom.js";
import { flatten } from "./explain/plan.js";
import { buffersText, costText, rowsText, timeText, totals } from "./explain/words.js";
import { t } from "./strings/index.js";
import { flameView } from "./view-plan-flame.js";
import { marksView } from "./view-plan-marks.js";
import { tableView } from "./view-plan-table.js";

/**
 * @typedef {import("./explain/plan.js").PlanNode} PlanNode
 * @typedef {import("./tabs.js").Tab} Tab
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const VIEWS = /** @type {const} */ ([
  ["tree", "plan.viewTree"],
  ["flame", "plan.viewFlame"],
  ["table", "plan.viewTable"],
]);

/** The plan as an outline. */
export function treeView(/** @type {Document} */ doc, /** @type {PlanNode} */ root) {
  const rows = flatten(root).map(({ node, depth }, i) => {
    const facts = [
      node.cost !== null ? t("plan.cost", { cost: costText(node.cost) }) : "",
      rowsText(node),
      timeText(node),
      buffersText(node.buffers),
    ].filter(Boolean);
    const hot =
      node.hot === "high" ? t("plan.hotHigh") : node.hot === "medium" ? t("plan.hotMedium") : "";
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
      el(
        doc,
        "span",
        { class: "plan-name" },
        el(doc, "span", { class: "plan-label" }, node.label),
        hot ? el(doc, "span", { class: "plan-hot" }, hot) : undefined,
      ),
      el(doc, "span", { class: "plan-facts" }, facts.join(" · ")),
      el(
        doc,
        "span",
        {
          class: "plan-share",
          title: t("plan.shareTitle", { share }),
          "aria-label": t("plan.shareLabel", { share }),
        },
        el(doc, "span", { class: "plan-bar", style: `width: ${Math.min(100, share)}%` }),
      ),
      marksView(doc, node),
      node.detail ? el(doc, "span", { class: "plan-detail" }, node.detail) : undefined,
    );
  });
  const tree = el(
    doc,
    "ul",
    { class: "plan", role: "tree", "aria-label": t("plan.label") },
    ...rows,
  );
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

/** The statement's totals, one line. */
function summaryView(/** @type {Document} */ doc, /** @type {PlanNode} */ root) {
  const facts = totals(root);
  if (!facts.length) return undefined;
  return el(
    doc,
    "dl",
    { class: "plan-summary", "aria-label": t("plan.totals") },
    ...facts.flatMap(([name, value]) => [
      el(doc, "dt", {}, name),
      el(doc, "dd", { title: value }, value),
    ]),
  );
}

/** The bar: how the plan is shown, and what can be done with it. */
function toolsView(/** @type {Document} */ doc, /** @type {Tab} */ tab, /** @type {Act} */ act) {
  const view = tab.view ?? "tree";
  const button = (
    /** @type {string} */ label,
    /** @type {string} */ title,
    /** @type {() => unknown} */ run,
  ) => {
    const b = el(doc, "button", { type: "button", class: "desk-btn desk-btn-quiet", title }, label);
    b.addEventListener("click", run);
    return b;
  };
  const views = el(
    doc,
    "div",
    { class: "desk-tabs plan-views", role: "tablist", "aria-label": t("plan.showAs") },
    ...VIEWS.map(([id, label]) => {
      const b = el(
        doc,
        "button",
        {
          type: "button",
          role: "tab",
          class: "desk-tab",
          "aria-selected": String(id === view),
          "data-view": id,
        },
        t(label),
      );
      b.addEventListener("click", () => act("planView", id));
      return b;
    }),
  );
  return el(
    doc,
    "div",
    { class: "plan-tools", role: "toolbar", "aria-label": t("plan.tools") },
    views,
    el(doc, "span", { class: "grow" }),
    button(t("plan.copyText"), t("plan.copyTextTitle"), () => act("copyPlan", "text")),
    button(t("plan.copyJson"), t("plan.copyJsonTitle"), () => act("copyPlan", "json")),
    button(t("plan.compare"), t("plan.compareTitle"), () => act("comparePlans")),
    tab.plan?.summary
      ? button(t("plan.options"), t("plan.optionsTitle"), () => act("explainOptions"))
      : undefined,
  );
}

/**
 * A plan tab: its totals, its bar and the plan drawn as the tab says.
 * @param {Document} doc
 * @param {Tab} tab
 * @param {Act} [act]
 */
export function planView(doc, tab, act = () => undefined) {
  const root = /** @type {PlanNode} */ (tab.plan);
  const view = tab.view ?? "tree";
  const body =
    view === "flame"
      ? flameView(doc, root)
      : view === "table"
        ? tableView(doc, root)
        : treeView(doc, root);
  return el(
    doc,
    "div",
    { class: "plan-box" },
    summaryView(doc, root),
    toolsView(doc, tab, act),
    body,
  );
}
